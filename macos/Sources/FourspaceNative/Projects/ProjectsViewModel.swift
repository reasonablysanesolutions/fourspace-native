import Foundation

/// Projects space: the project list, creating/importing folders, and the
/// selected project's threads.
@MainActor
@Observable
final class ProjectsViewModel {
    let harness: HarnessStore
    let conversation = ConversationViewModel()

    var projects: [T3ProjectShell] = []
    var threadsByProject: [String: [T3ThreadShell]] = [:]
    var selectedProjectId: String?
    var activeThreadId: String?
    var draft: String = ""
    var errorText: String?
    var isBusy = false

    init(harness: HarnessStore) {
        self.harness = harness
        conversation.onAssistantComplete = { [weak self] in
            Task { await self?.refresh() }
        }
    }

    var selectedProject: T3ProjectShell? {
        projects.first { $0.id == selectedProjectId }
    }

    var projectThreads: [T3ThreadShell] {
        selectedProjectId.flatMap { threadsByProject[$0] } ?? []
    }

    var messages: [ChatMessage] { conversation.messages }

    var canSend: Bool {
        harness.isConnected && !conversation.isStreaming
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && harness.selectedModel != nil && activeThreadId != nil
    }

    // MARK: - Loading

    func refresh() async {
        guard harness.isConnected else { return }
        guard let shell = try? await harness.loadShell() else { return }
        projects = shell.projects.sorted {
            $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
        }
        threadsByProject = Dictionary(grouping: shell.threads, by: { $0.projectId })
            .mapValues { $0.sorted { $0.updatedAt > $1.updatedAt } }
    }

    // MARK: - Selection

    func selectProject(_ id: String) {
        guard id != selectedProjectId else { return }
        selectedProjectId = id
        activeThreadId = nil
        conversation.close()
    }

    func selectThread(_ id: String) {
        activeThreadId = id
        Task { await conversation.open(threadId: id, harness: harness) }
    }

    // MARK: - Creating / importing

    func createProject(title: String, parentDirectory: URL) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isBusy = true
        errorText = nil
        defer { isBusy = false }
        do {
            let root = parentDirectory.appendingPathComponent(trimmed).path
            let id = try await harness.createProject(
                title: trimmed,
                workspaceRoot: root,
                createIfMissing: true
            )
            await refresh()
            selectProject(id)
        } catch {
            errorText = error.localizedDescription
        }
    }

    /// Adopts an existing folder as a project. The folder is never moved or
    /// copied.
    func importFolder(_ url: URL) async {
        isBusy = true
        errorText = nil
        defer { isBusy = false }
        do {
            let id = try await harness.createProject(
                title: url.lastPathComponent,
                workspaceRoot: url.path,
                createIfMissing: false
            )
            await refresh()
            selectProject(id)
        } catch {
            errorText = error.localizedDescription
        }
    }

    // MARK: - Threads

    func newThread() async {
        guard let projectId = selectedProjectId else { return }
        do {
            let threadId = try await harness.createThread(projectId: projectId, title: "New Thread")
            await refresh()
            activeThreadId = threadId
            await conversation.open(threadId: threadId, harness: harness)
        } catch {
            errorText = error.localizedDescription
        }
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let threadId = activeThreadId else { return }
        draft = ""
        errorText = nil
        do {
            try await harness.startTurn(threadId: threadId, text: text)
        } catch {
            errorText = error.localizedDescription
        }
    }
}
