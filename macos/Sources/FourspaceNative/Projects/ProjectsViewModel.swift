import Foundation

/// Projects space: the project list, creating/importing folders, and the
/// selected project's threads.
@MainActor
@Observable
final class ProjectsViewModel {
    let harness: HarnessStore
    let registry: FourSpacesRegistry
    let conversation = ConversationViewModel()

    /// Which kind space is showing. Filters the list via the registry.
    var space: FourSpace = .project

    var projects: [T3ProjectShell] = []
    var threadsByProject: [String: [T3ThreadShell]] = [:]
    var selectedProjectId: String?
    var activeThreadId: String?
    var draft: String = ""
    var errorText: String?
    var isBusy = false

    init(harness: HarnessStore, registry: FourSpacesRegistry) {
        self.harness = harness
        self.registry = registry
        conversation.onAssistantComplete = { [weak self] in
            Task { await self?.refresh() }
        }
    }

    var visibleProjects: [T3ProjectShell] {
        projects.filter { registry.isVisible(projectId: $0.id, in: space) }
    }

    var selectedProject: T3ProjectShell? {
        projects.first { $0.id == selectedProjectId }
    }

    var linkedProjects: [T3ProjectShell] {
        guard let productId = selectedProjectId else { return [] }
        return registry.linked(toProduct: productId, among: projects)
    }

    func kind(for project: T3ProjectShell) -> FourSpaceKind? {
        registry.kind(for: project.id)
    }

    func setSpace(_ newSpace: FourSpace) {
        guard newSpace != space else { return }
        space = newSpace
        if let selected = selectedProject, !registry.isVisible(projectId: selected.id, in: newSpace) {
            selectedProjectId = nil
            activeThreadId = nil
            conversation.close()
        }
    }

    func classify(_ kind: FourSpaceKind?, project: T3ProjectShell, originProductId: String? = nil) {
        registry.setKind(kind, for: project, originProductId: originProductId)
    }

    var products: [T3ProjectShell] {
        projects.filter { registry.kind(for: $0.id) == .product }
    }

    func originProduct(for project: T3ProjectShell) -> T3ProjectShell? {
        guard let id = registry.originProductId(for: project.id) else { return nil }
        return projects.first { $0.id == id }
    }

    func link(_ project: T3ProjectShell, toProduct product: T3ProjectShell) {
        if registry.kind(for: project.id) == nil {
            registry.setKind(.experiment, for: project)
        }
        registry.setOriginProduct(product.id, for: project)
    }

    func unlink(_ project: T3ProjectShell) {
        registry.setOriginProduct(nil, for: project)
    }

    /// Newly created/imported projects adopt the kind of the space they were
    /// created in.
    private func classifyNewProject(_ id: String) {
        guard let kind = space.kind, let project = projects.first(where: { $0.id == id }) else { return }
        registry.setKind(kind, for: project)
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
            classifyNewProject(id)
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
            classifyNewProject(id)
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
