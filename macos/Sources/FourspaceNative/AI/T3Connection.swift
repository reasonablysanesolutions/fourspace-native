import Foundation

struct T3Model: Identifiable, Hashable, Sendable {
    let slug: String
    let name: String
    var id: String { slug }
}

struct T3Provider: Identifiable, Hashable, Sendable {
    let instanceId: String
    let driver: String
    let displayName: String?
    let status: String
    let installed: Bool
    let enabled: Bool
    let models: [T3Model]

    var id: String { instanceId }

    var label: String { displayName ?? driver }

    var isReady: Bool {
        installed && enabled && status != "disabled" && status != "error"
    }
}

struct T3ProjectShell: Sendable {
    let id: String
    let title: String
    let workspaceRoot: String
}

struct T3ThreadShell: Sendable {
    let id: String
    let projectId: String
    let title: String
    let updatedAt: String
}

struct T3ServerConfig: Sendable {
    let environmentId: String
    let cwd: String
    let providers: [T3Provider]

    init(json: JSONValue) {
        environmentId = json["environment"]?["environmentId"]?.stringValue ?? "unknown"
        cwd = json["cwd"]?.stringValue ?? ""
        providers = (json["providers"]?.arrayValue ?? []).map { provider in
            T3Provider(
                instanceId: provider["instanceId"]?.stringValue ?? "unknown",
                driver: provider["driver"]?.stringValue ?? "unknown",
                displayName: provider["displayName"]?.stringValue,
                status: provider["status"]?.stringValue ?? "unknown",
                installed: provider["installed"]?.boolValue ?? false,
                enabled: provider["enabled"]?.boolValue ?? false,
                models: (provider["models"]?.arrayValue ?? []).map { model in
                    T3Model(
                        slug: model["slug"]?.stringValue ?? "unknown",
                        name: model["name"]?.stringValue ?? model["slug"]?.stringValue ?? "unknown"
                    )
                }
            )
        }
    }
}

/// High-level typed façade over the T3 WebSocket API. Owns one `T3RpcClient`
/// and builds orchestration commands.
actor T3Connection {
    private let rpc: T3RpcClient
    private(set) var config: T3ServerConfig?

    init(baseURL: URL, token: String?) {
        rpc = T3RpcClient(baseURL: baseURL, token: token)
    }

    func connect() async throws {
        try await rpc.connect()
        config = try await loadConfig()
    }

    func disconnect() async {
        await rpc.disconnect()
        config = nil
    }

    func loadConfig() async throws -> T3ServerConfig {
        let value = try await rpc.request(tag: "server.getConfig", payload: .object([:]))
        let config = T3ServerConfig(json: value)
        self.config = config
        return config
    }

    // MARK: - Shell

    /// Reads the lightweight shell snapshot (projects + thread summaries) by
    /// subscribing once and stopping at the first snapshot frame.
    func loadShell() async throws -> (projects: [T3ProjectShell], threads: [T3ThreadShell]) {
        let stream = rpc.stream(tag: "orchestration.subscribeShell", payload: .object([:]))
        for try await item in stream {
            guard item["kind"]?.stringValue == "snapshot", let snapshot = item["snapshot"] else {
                continue
            }
            let projects = (snapshot["projects"]?.arrayValue ?? []).compactMap { project -> T3ProjectShell? in
                guard let id = project["id"]?.stringValue,
                      let root = project["workspaceRoot"]?.stringValue else { return nil }
                return T3ProjectShell(
                    id: id,
                    title: project["title"]?.stringValue ?? "",
                    workspaceRoot: root
                )
            }
            let threads = (snapshot["threads"]?.arrayValue ?? []).compactMap { thread -> T3ThreadShell? in
                guard let id = thread["id"]?.stringValue,
                      let projectId = thread["projectId"]?.stringValue else { return nil }
                return T3ThreadShell(
                    id: id,
                    projectId: projectId,
                    title: thread["title"]?.stringValue ?? "",
                    updatedAt: thread["updatedAt"]?.stringValue ?? ""
                )
            }
            return (projects, threads)
        }
        return ([], [])
    }

    // MARK: - Orchestration

    /// Resolves a workspace by its root: reuses an existing project and its
    /// most recent thread, or creates both. This is how Four Space adopts a
    /// plain folder without ever moving or converting it.
    func openOrCreateWorkspace(
        workspaceRoot: String,
        projectTitle: String,
        threadTitle: String,
        modelSelection: JSONValue
    ) async throws -> (projectId: String, threadId: String) {
        let shell = try await loadShell()
        let normalized = Self.normalize(workspaceRoot)

        let projectId: String
        if let existing = shell.projects.first(where: { Self.normalize($0.workspaceRoot) == normalized }) {
            projectId = existing.id
        } else {
            projectId = try await createProject(
                title: projectTitle,
                workspaceRoot: workspaceRoot,
                createIfMissing: true
            )
        }

        if let existingThread = shell.threads
            .filter({ $0.projectId == projectId })
            .max(by: { $0.updatedAt < $1.updatedAt }) {
            return (projectId, existingThread.id)
        }

        let threadId = try await createThread(
            projectId: projectId,
            title: threadTitle,
            modelSelection: modelSelection
        )
        return (projectId, threadId)
    }

    func dispatch(_ command: JSONValue) async throws {
        _ = try await rpc.request(tag: "orchestration.dispatchCommand", payload: command)
    }

    func createProject(title: String, workspaceRoot: String, createIfMissing: Bool) async throws -> String {
        let projectId = UUID().uuidString
        try await dispatch(.object([
            "type": "project.create",
            "commandId": .string(UUID().uuidString),
            "projectId": .string(projectId),
            "title": .string(title),
            "workspaceRoot": .string(workspaceRoot),
            "createWorkspaceRootIfMissing": .bool(createIfMissing),
            "createdAt": .string(Self.isoNow()),
        ]))
        return projectId
    }

    func deleteProject(projectId: String) async throws {
        try await dispatch(.object([
            "type": "project.delete",
            "commandId": .string(UUID().uuidString),
            "projectId": .string(projectId),
            "force": .bool(true),
        ]))
    }

    func updateProjectWorkspace(projectId: String, workspaceRoot: String) async throws {
        try await dispatch(.object([
            "type": "project.meta.update",
            "commandId": .string(UUID().uuidString),
            "projectId": .string(projectId),
            "workspaceRoot": .string(workspaceRoot),
        ]))
    }

    /// Moves or copies a folder on the server host (cross-volume safe) via the
    /// Four Spaces relocation RPC. Returns the resulting path.
    func relocateWorkspace(sourcePath: String, destinationPath: String, mode: String) async throws -> String {
        let result = try await rpc.request(tag: "fourspaces.relocateWorkspace", payload: .object([
            "sourcePath": .string(sourcePath),
            "destinationPath": .string(destinationPath),
            "mode": .string(mode),
        ]))
        return result["destinationPath"]?.stringValue ?? destinationPath
    }

    func createThread(
        projectId: String,
        title: String,
        modelSelection: JSONValue
    ) async throws -> String {
        let threadId = UUID().uuidString
        try await dispatch(.object([
            "type": "thread.create",
            "commandId": .string(UUID().uuidString),
            "threadId": .string(threadId),
            "projectId": .string(projectId),
            "title": .string(title),
            "modelSelection": modelSelection,
            "runtimeMode": "full-access",
            "interactionMode": "default",
            "branch": .null,
            "worktreePath": .null,
            "createdAt": .string(Self.isoNow()),
        ]))
        return threadId
    }

    func startTurn(threadId: String, text: String, modelSelection: JSONValue) async throws {
        try await dispatch(.object([
            "type": "thread.turn.start",
            "commandId": .string(UUID().uuidString),
            "threadId": .string(threadId),
            "message": .object([
                "messageId": .string(UUID().uuidString),
                "role": "user",
                "text": .string(text),
                "attachments": .array([]),
            ]),
            "modelSelection": modelSelection,
            "runtimeMode": "full-access",
            "interactionMode": "default",
            "createdAt": .string(Self.isoNow()),
        ]))
    }

    nonisolated func subscribeThread(threadId: String) -> AsyncThrowingStream<JSONValue, Error> {
        rpc.stream(tag: "orchestration.subscribeThread", payload: .object([
            "threadId": .string(threadId),
            "reasoningMessages": .bool(true),
            "requestCompletionMarker": .bool(true),
        ]))
    }

    static func modelSelection(provider: T3Provider, model: T3Model) -> JSONValue {
        .object([
            "instanceId": .string(provider.instanceId),
            "model": .string(model.slug),
        ])
    }

    static func isoNow() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    static func normalize(_ path: String) -> String {
        path.hasSuffix("/") ? String(path.dropLast()) : path
    }
}
