import Foundation

enum ConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case failed(String)
}

enum HarnessError: Error, LocalizedError {
    case notConnected
    case noModel

    var errorDescription: String? {
        switch self {
        case .notConnected: "Not connected to a T3 server."
        case .noModel: "No model is selected."
        }
    }
}

/// Shared owner of the T3 connection: server lifecycle, provider catalog,
/// model selection, and the orchestration RPCs. Chat and Projects both use the
/// same instance so there is one server and one session.
@MainActor
@Observable
final class HarnessStore {
    var serverURL: String
    var token: String

    var connectionState: ConnectionState = .disconnected
    var providers: [T3Provider] = []
    var selectedProviderId: String?
    var selectedModelSlug: String?
    var errorText: String?

    private(set) var serverController: ServerController?
    private var connection: T3Connection?
    private let tokenFromEnvironment: Bool

    private enum DefaultsKey {
        static let serverURL = "fourspace.serverURL"
        static let providerId = "fourspace.selectedProviderId"
        static let modelSlug = "fourspace.selectedModelSlug"
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

    var isConnected: Bool { connectionState == .connected }

    var currentModelSelection: JSONValue? {
        guard let provider = selectedProvider, let model = selectedModel else { return nil }
        return T3Connection.modelSelection(provider: provider, model: model)
    }

    // MARK: - Connection

    func connect() async {
        if connectionState == .connected { return }
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespaces)) else {
            connectionState = .failed("Invalid server URL.")
            return
        }
        connectionState = .connecting
        errorText = nil
        UserDefaults.standard.set(serverURL, forKey: DefaultsKey.serverURL)

        do {
            try await establish(url: url, forceSpawn: false)
        } catch {
            // The server may have vanished between the reachability probe and
            // the handshake (e.g. another instance was shutting down). Retry:
            // attach if something is listening again, otherwise spawn our own.
            do {
                let reachable = await ServerController.isReachable(url)
                try await establish(url: url, forceSpawn: !reachable)
            } catch {
                connectionState = .failed(error.localizedDescription)
                connection = nil
            }
        }
    }

    private func establish(url: URL, forceSpawn: Bool) async throws {
        let controller = ServerController(baseURL: url)
        let minted = try await controller.ensureRunning(forceSpawn: forceSpawn)

        let effectiveToken: String? = minted ?? (token.isEmpty ? nil : token)
        let connection = T3Connection(baseURL: url, token: effectiveToken)
        try await connection.connect()
        let config = try await connection.loadConfig()

        serverController = controller
        self.connection = connection
        providers = config.providers
        restoreSelection()
        connectionState = .connected

        if tokenFromEnvironment || minted != nil {
            // Ephemeral credential; do not write it to the Keychain.
        } else if token.isEmpty {
            Keychain.delete(account: "t3.bearerToken")
        } else {
            Keychain.set(token, account: "t3.bearerToken")
        }
    }

    func disconnect() async {
        await connection?.disconnect()
        connection = nil
        connectionState = .disconnected
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

    // MARK: - Orchestration

    func loadShell() async throws -> (projects: [T3ProjectShell], threads: [T3ThreadShell]) {
        guard let connection else { throw HarnessError.notConnected }
        return try await connection.loadShell()
    }

    func createProject(title: String, workspaceRoot: String, createIfMissing: Bool) async throws -> String {
        guard let connection else { throw HarnessError.notConnected }
        return try await connection.createProject(
            title: title,
            workspaceRoot: workspaceRoot,
            createIfMissing: createIfMissing
        )
    }

    func createThread(projectId: String, title: String) async throws -> String {
        guard let connection, let modelSelection = currentModelSelection else {
            throw currentModelSelection == nil ? HarnessError.noModel : HarnessError.notConnected
        }
        return try await connection.createThread(
            projectId: projectId,
            title: title,
            modelSelection: modelSelection
        )
    }

    func deleteProject(projectId: String) async throws {
        guard let connection else { throw HarnessError.notConnected }
        try await connection.deleteProject(projectId: projectId)
    }

    func updateProjectWorkspace(projectId: String, workspaceRoot: String) async throws {
        guard let connection else { throw HarnessError.notConnected }
        try await connection.updateProjectWorkspace(projectId: projectId, workspaceRoot: workspaceRoot)
    }

    func relocateWorkspace(
        sourcePath: String,
        destinationPath: String,
        mode: FourSpaceImportMode
    ) async throws -> String {
        guard let connection else { throw HarnessError.notConnected }
        return try await connection.relocateWorkspace(
            sourcePath: sourcePath,
            destinationPath: destinationPath,
            mode: mode.rawValue
        )
    }

    func openOrCreateWorkspace(
        workspaceRoot: String,
        projectTitle: String,
        threadTitle: String
    ) async throws -> (projectId: String, threadId: String) {
        guard let connection, let modelSelection = currentModelSelection else {
            throw currentModelSelection == nil ? HarnessError.noModel : HarnessError.notConnected
        }
        return try await connection.openOrCreateWorkspace(
            workspaceRoot: workspaceRoot,
            projectTitle: projectTitle,
            threadTitle: threadTitle,
            modelSelection: modelSelection
        )
    }

    func startTurn(threadId: String, text: String) async throws {
        guard let connection, let modelSelection = currentModelSelection else {
            throw currentModelSelection == nil ? HarnessError.noModel : HarnessError.notConnected
        }
        try await connection.startTurn(threadId: threadId, text: text, modelSelection: modelSelection)
    }

    func subscribeThread(threadId: String) async -> AsyncThrowingStream<JSONValue, Error>? {
        guard let connection else { return nil }
        return connection.subscribeThread(threadId: threadId)
    }
}
