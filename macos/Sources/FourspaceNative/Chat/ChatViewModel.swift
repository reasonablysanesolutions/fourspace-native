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

/// Drives a single live chat against a T3 server. Phase 4 scope: connect,
/// pick a provider/model, create a hidden Chat workspace, stream one turn.
@MainActor
@Observable
final class ChatViewModel {
    var serverURL: String
    var token: String

    var connectionState: ChatConnectionState = .disconnected
    var providers: [T3Provider] = []
    var selectedProviderId: String?
    var selectedModelSlug: String?

    var messages: [ChatMessage] = []
    var draft: String = ""
    var errorText: String?

    private var connection: T3Connection?
    private var projectId: String?
    private var threadId: String?
    private var streamTask: Task<Void, Never>?

    init() {
        serverURL = UserDefaults.standard.string(forKey: "fourspace.serverURL") ?? "http://127.0.0.1:4611"
        token = Keychain.get(account: "t3.bearerToken") ?? ""
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

    // MARK: - Connection

    func connect() async {
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespaces)) else {
            connectionState = .failed("Invalid server URL.")
            return
        }
        connectionState = .connecting
        errorText = nil
        UserDefaults.standard.set(serverURL, forKey: "fourspace.serverURL")
        if token.isEmpty {
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
            if selectedProvider == nil {
                selectedProviderId = availableProviders.first?.instanceId
            }
            if selectedModel == nil {
                selectedModelSlug = availableProviders.first?.models.first?.slug
            }
            connectionState = .connected
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
    }

    // MARK: - Sending

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let connection, let provider = selectedProvider, let model = selectedModel else {
            return
        }
        draft = ""
        errorText = nil

        do {
            if threadId == nil {
                try await openChatWorkspace(connection: connection, provider: provider, model: model)
            }
            guard let threadId else { return }
            try await connection.startTurn(
                threadId: threadId,
                text: text,
                modelSelection: T3Connection.modelSelection(provider: provider, model: model)
            )
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func openChatWorkspace(
        connection: T3Connection,
        provider: T3Provider,
        model: T3Model
    ) async throws {
        let root = (NSHomeDirectory() as NSString).appendingPathComponent("FourSpace/Chat")
        let shell = try await connection.loadShell()
        let normalizedRoot = Self.normalize(root)

        let projectId: String
        if let existing = shell.projects.first(where: { Self.normalize($0.workspaceRoot) == normalizedRoot }) {
            projectId = existing.id
        } else {
            projectId = try await connection.createProject(
                title: "Chat",
                workspaceRoot: root,
                createIfMissing: true
            )
        }

        let threadId: String
        if let existing = shell.threads
            .filter({ $0.projectId == projectId })
            .max(by: { $0.updatedAt < $1.updatedAt }) {
            threadId = existing.id
        } else {
            threadId = try await connection.createThread(
                projectId: projectId,
                title: "New Chat",
                modelSelection: T3Connection.modelSelection(provider: provider, model: model)
            )
        }

        self.projectId = projectId
        self.threadId = threadId
        startStreaming(connection: connection, threadId: threadId)
    }

    private static func normalize(_ path: String) -> String {
        path.hasSuffix("/") ? String(path.dropLast()) : path
    }

    private func startStreaming(connection: T3Connection, threadId: String) {
        streamTask?.cancel()
        messages = []
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
            guard let event = item["event"], event["type"]?.stringValue == "thread.message-sent" else {
                return
            }
            applyMessageEvent(event["payload"])
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
    }
}
