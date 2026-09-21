import Foundation

/// Chat space: the hidden Chat workspace and its thread list, over the shared
/// `HarnessStore`.
@MainActor
@Observable
final class ChatViewModel {
    let harness: HarnessStore
    let registry: FourSpacesRegistry
    let conversation = ConversationViewModel()

    var threads: [T3ThreadShell] = []
    var activeThreadId: String?
    var draft: String = ""
    var errorText: String?

    private var chatProjectId: String?

    private enum DefaultsKey {
        static let activeThreadId = "fourspace.activeThreadId"
    }

    init(harness: HarnessStore, registry: FourSpacesRegistry) {
        self.harness = harness
        self.registry = registry
        activeThreadId = UserDefaults.standard.string(forKey: DefaultsKey.activeThreadId)
        conversation.onAssistantComplete = { [weak self] in
            Task { await self?.refreshThreads() }
        }
    }

    var connectionState: ConnectionState { harness.connectionState }
    var availableProviders: [T3Provider] { harness.availableProviders }
    var selectedProvider: T3Provider? { harness.selectedProvider }
    var selectedModel: T3Model? { harness.selectedModel }
    var serverController: ServerController? { harness.serverController }
    var messages: [ChatMessage] { conversation.messages }
    var hasStreamingMessage: Bool { conversation.isStreaming }

    var canSend: Bool {
        harness.isConnected && !conversation.isStreaming
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && harness.selectedModel != nil
    }

    var activeThread: T3ThreadShell? {
        threads.first { $0.id == activeThreadId }
    }

    // MARK: - Connection

    func connect() async {
        await harness.connect()
        guard harness.isConnected else { return }
        await openChatWorkspace()
    }

    private func openChatWorkspace() async {
        do {
            let opened = try await harness.openOrCreateWorkspace(
                workspaceRoot: Self.chatRoot(),
                projectTitle: "Chat",
                threadTitle: "New Chat"
            )
            chatProjectId = opened.projectId
            registry.setChatProject(opened.projectId)
            await refreshThreads()

            if activeThreadId == nil || !threads.contains(where: { $0.id == activeThreadId }) {
                activeThreadId = opened.threadId
                persistActiveThread()
            }
            if let activeThreadId {
                await conversation.open(threadId: activeThreadId, harness: harness)
            }
        } catch {
            errorText = error.localizedDescription
        }
    }

    // MARK: - Threads

    func refreshThreads() async {
        guard let projectId = chatProjectId else { return }
        guard let shell = try? await harness.loadShell() else { return }
        threads = shell.threads
            .filter { $0.projectId == projectId }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    func newChat() async {
        guard let projectId = chatProjectId else { return }
        do {
            let threadId = try await harness.createThread(projectId: projectId, title: "New Chat")
            threads.insert(
                T3ThreadShell(id: threadId, projectId: projectId, title: "New Chat", updatedAt: T3Connection.isoNow()),
                at: 0
            )
            activeThreadId = threadId
            persistActiveThread()
            await conversation.open(threadId: threadId, harness: harness)
        } catch {
            errorText = error.localizedDescription
        }
    }

    func selectThread(_ id: String) {
        guard id != activeThreadId || conversation.messages.isEmpty else { return }
        activeThreadId = id
        persistActiveThread()
        Task { await conversation.open(threadId: id, harness: harness) }
    }

    private func persistActiveThread() {
        UserDefaults.standard.set(activeThreadId, forKey: DefaultsKey.activeThreadId)
    }

    // MARK: - Sending

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, harness.isConnected, harness.selectedModel != nil else { return }
        draft = ""
        errorText = nil

        do {
            let threadId: String
            if let active = activeThreadId {
                threadId = active
            } else {
                guard let projectId = chatProjectId else { return }
                threadId = try await harness.createThread(projectId: projectId, title: "New Chat")
                activeThreadId = threadId
                persistActiveThread()
                await conversation.open(threadId: threadId, harness: harness)
            }
            try await harness.startTurn(threadId: threadId, text: text)
        } catch {
            errorText = error.localizedDescription
        }
    }

    static func chatRoot() -> String {
        (NSHomeDirectory() as NSString).appendingPathComponent("FourSpace/Chat")
    }
}
