import Foundation

struct ChatMessage: Identifiable, Hashable, Sendable {
    let id: String
    var role: String
    var text: String
    var streaming: Bool
}

enum ChatConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case failed(String)
}

/// Drives Chat: connection, provider/model selection, the thread list, and the
/// live transcript for the selected thread.
@MainActor
@Observable
final class ChatViewModel {
    var serverURL: String
    var token: String

    var connectionState: ChatConnectionState = .disconnected
    var providers: [T3Provider] = []
    var selectedProviderId: String?
    var selectedModelSlug: String?

    var threads: [T3ThreadShell] = []
    var activeThreadId: String?

    var messages: [ChatMessage] = []
    var draft: String = ""
    var errorText: String?

    private var connection: T3Connection?
    private var chatProjectId: String?
    private var streamTask: Task<Void, Never>?
    /// A token supplied via `FOURSPACE_TOKEN` is dev-only and never persisted.
    private let tokenFromEnvironment: Bool

    private enum DefaultsKey {
        static let serverURL = "fourspace.serverURL"
        static let providerId = "fourspace.selectedProviderId"
        static let modelSlug = "fourspace.selectedModelSlug"
        static let activeThreadId = "fourspace.activeThreadId"
    }

    init() {
        let defaults = UserDefaults.standard
        let environment = ProcessInfo.processInfo.environment
        serverURL = environment["FOURSPACE_URL"]
            ?? defaults.string(forKey: DefaultsKey.serverURL)
            ?? "http://127.0.0.1:4611"
        if let envToken = environment["FOURSPACE_TOKEN"], !envToken.isEmpty {
            token = envToken
            tokenFromEnvironment = true
        } else {
            token = Keychain.get(account: "t3.bearerToken") ?? ""
            tokenFromEnvironment = false
        }
        selectedProviderId = defaults.string(forKey: DefaultsKey.providerId)
        selectedModelSlug = defaults.string(forKey: DefaultsKey.modelSlug)
        activeThreadId = defaults.string(forKey: DefaultsKey.activeThreadId)
    }

    var availableProviders: [T3Provider] {
        providers.filter { $0.isReady && !$0.models.isEmpty }
    }

    var selectedProvider: T3Provider? {
        providers.first { $0.instanceId == selectedProviderId }
    }

    var selectedModel: T3Model? {
        selectedProvider?.models.first { $0.slug == selectedModelSlug }
    }

    var hasStreamingMessage: Bool {
        messages.contains { $0.streaming }
    }

    var canSend: Bool {
        connectionState == .connected && !hasStreamingMessage
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && selectedModel != nil
    }

    var activeThread: T3ThreadShell? {
        threads.first { $0.id == activeThreadId }
    }

    // MARK: - Connection

    func connect() async {
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespaces)) else {
            connectionState = .failed("Invalid server URL.")
            return
        }
        connectionState = .connecting
        errorText = nil
        UserDefaults.standard.set(serverURL, forKey: DefaultsKey.serverURL)
        if tokenFromEnvironment {
            // Dev-only token; do not write it to the Keychain.
        } else if token.isEmpty {
            Keychain.delete(account: "t3.bearerToken")
        } else {
            Keychain.set(token, account: "t3.bearerToken")
        }

        let connection = T3Connection(baseURL: url, token: token.isEmpty ? nil : token)
        do {
            try await connection.connect()
            let config = try await connection.loadConfig()
            self.connection = connection
            providers = config.providers
            restoreSelection()
            connectionState = .connected
            await openChatWorkspace()
        } catch {
            connectionState = .failed(error.localizedDescription)
            self.connection = nil
        }
    }

    func disconnect() async {
        streamTask?.cancel()
        streamTask = nil
        await connection?.disconnect()
        connection = nil
        connectionState = .disconnected
        threads = []
        messages = []
        chatProjectId = nil
    }

    private func restoreSelection() {
        if selectedProvider == nil || selectedModel == nil {
            selectedProviderId = availableProviders.first?.instanceId
            selectedModelSlug = availableProviders.first?.models.first?.slug
        }
    }

    func selectModel(provider: T3Provider, model: T3Model) {
        selectedProviderId = provider.instanceId
        selectedModelSlug = model.slug
        UserDefaults.standard.set(provider.instanceId, forKey: DefaultsKey.providerId)
        UserDefaults.standard.set(model.slug, forKey: DefaultsKey.modelSlug)
    }

    // MARK: - Threads

    private func openChatWorkspace() async {
        guard let connection, let provider = selectedProvider, let model = selectedModel else { return }
        do {
            let opened = try await connection.openOrCreateWorkspace(
                workspaceRoot: Self.chatRoot(),
                projectTitle: "Chat",
                threadTitle: "New Chat",
                modelSelection: T3Connection.modelSelection(provider: provider, model: model)
            )
            chatProjectId = opened.projectId
            await refreshThreads()

            if activeThreadId == nil || !threads.contains(where: { $0.id == activeThreadId }) {
                activeThreadId = opened.threadId
                persistActiveThread()
            }
            if let activeThreadId {
                startStreaming(connection: connection, threadId: activeThreadId)
            }
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func applyThreads(_ incoming: [T3ThreadShell]) {
        threads = incoming.sorted { $0.updatedAt > $1.updatedAt }
    }

    /// Reloads the shell so generated titles and ordering stay current.
    func refreshThreads() async {
        guard let connection, let projectId = chatProjectId else { return }
        guard let shell = try? await connection.loadShell() else { return }
        applyThreads(shell.threads.filter { $0.projectId == projectId })
    }

    func newChat() async {
        guard let connection, let projectId = chatProjectId,
              let provider = selectedProvider, let model = selectedModel else {
            return
        }
        do {
            let threadId = try await connection.createThread(
                projectId: projectId,
                title: "New Chat",
                modelSelection: T3Connection.modelSelection(provider: provider, model: model)
            )
            threads.insert(
                T3ThreadShell(id: threadId, projectId: projectId, title: "New Chat", updatedAt: T3Connection.isoNow()),
                at: 0
            )
            selectThread(threadId)
        } catch {
            errorText = error.localizedDescription
        }
    }

    func selectThread(_ id: String) {
        guard id != activeThreadId || messages.isEmpty else { return }
        activeThreadId = id
        persistActiveThread()
        messages = []
        if let connection {
            startStreaming(connection: connection, threadId: id)
        }
    }

    private func persistActiveThread() {
        UserDefaults.standard.set(activeThreadId, forKey: DefaultsKey.activeThreadId)
    }

    // MARK: - Sending

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let connection,
              let provider = selectedProvider, let model = selectedModel else {
            return
        }
        draft = ""
        errorText = nil

        do {
            let threadId: String
            if let active = activeThreadId {
                threadId = active
            } else {
                guard let projectId = chatProjectId else { return }
                threadId = try await connection.createThread(
                    projectId: projectId,
                    title: "New Chat",
                    modelSelection: T3Connection.modelSelection(provider: provider, model: model)
                )
                activeThreadId = threadId
                persistActiveThread()
                startStreaming(connection: connection, threadId: threadId)
            }
            try await connection.startTurn(
                threadId: threadId,
                text: text,
                modelSelection: T3Connection.modelSelection(provider: provider, model: model)
            )
        } catch {
            errorText = error.localizedDescription
        }
    }

    // MARK: - Streaming

    private func startStreaming(connection: T3Connection, threadId: String) {
        streamTask?.cancel()
        streamTask = Task { [weak self] in
            do {
                for try await item in connection.subscribeThread(threadId: threadId) {
                    guard let self else { return }
                    self.handleStreamItem(item)
                }
            } catch {
                self?.errorText = error.localizedDescription
            }
        }
    }

    private func handleStreamItem(_ item: JSONValue) {
        switch item["kind"]?.stringValue {
        case "snapshot":
            if let thread = item["snapshot"]?["thread"] {
                applySnapshot(thread)
            }
        case "event":
            guard let event = item["event"] else { return }
            if event["type"]?.stringValue == "thread.message-sent" {
                applyMessageEvent(event["payload"])
            }
        default:
            break
        }
    }

    private func applySnapshot(_ thread: JSONValue) {
        messages = (thread["messages"]?.arrayValue ?? []).compactMap { message in
            guard let id = message["id"]?.stringValue else { return nil }
            return ChatMessage(
                id: id,
                role: message["role"]?.stringValue ?? "assistant",
                text: message["text"]?.stringValue ?? "",
                streaming: message["streaming"]?.boolValue ?? false
            )
        }
    }

    private func applyMessageEvent(_ payload: JSONValue?) {
        guard let payload, let id = payload["messageId"]?.stringValue else { return }
        let role = payload["role"]?.stringValue ?? "assistant"
        let text = payload["text"]?.stringValue ?? ""
        let streaming = payload["streaming"]?.boolValue ?? false

        if let index = messages.firstIndex(where: { $0.id == id }) {
            if streaming {
                messages[index].text += text
                messages[index].streaming = true
            } else {
                if !text.isEmpty {
                    messages[index].text = text
                }
                messages[index].streaming = false
            }
        } else {
            messages.append(ChatMessage(id: id, role: role, text: text, streaming: streaming))
        }

        if !streaming, role == "assistant" {
            Task { await refreshThreads() }
        }
    }

    // MARK: - Helpers

    static func chatRoot() -> String {
        (NSHomeDirectory() as NSString).appendingPathComponent("FourSpace/Chat")
    }
}
