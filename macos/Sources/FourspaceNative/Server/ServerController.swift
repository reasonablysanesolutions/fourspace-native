import Darwin
import Foundation

/// Owns the lifecycle of a local T3 server process.
///
/// On launch the app asks the controller to ensure a server is reachable. If
/// one already listens at the URL the app attaches to it; otherwise the
/// controller spawns `node apps/server/src/bin.ts serve` as a child process,
/// waits until it is listening, and mints a bearer token for itself. When the
/// app terminates it stops the child it started (and only then).
@MainActor
@Observable
final class ServerController {
    enum State: Equatable {
        case stopped
        case starting
        case attached
        case owned
        case failed(String)
    }

    private(set) var state: State = .stopped
    private var process: Process?
    private var logHandle: FileHandle?

    let baseURL: URL
    let baseDirectory: String

    /// Termination hook for `AppDelegate`; the controller is not a singleton,
    /// this only lets the app delegate reach the live instance on quit.
    private static weak var current: ServerController?

    init(baseURL: URL, baseDirectory: String = ServerController.defaultBaseDirectory()) {
        self.baseURL = baseURL
        self.baseDirectory = baseDirectory
        ServerController.current = self
    }

    var isOwned: Bool { state == .owned }

    /// Ensures a server is reachable and returns a token to use.
    ///
    /// A non-nil token means the controller started the server and minted a
    /// fresh credential. `nil` means it attached to an existing server, and the
    /// caller should use its stored token.
    func ensureRunning(forceSpawn: Bool = false) async throws -> String? {
        if !forceSpawn, await Self.isReachable(baseURL) {
            state = .attached
            return nil
        }

        // Only a loopback URL can be satisfied by a locally spawned server.
        let host = baseURL.host ?? ""
        guard host == "127.0.0.1" || host == "localhost" || host == "::1" else {
            state = .failed("Server not reachable.")
            throw ServerError.notLocal(host)
        }

        state = .starting
        let process = try spawn()
        self.process = process

        do {
            try await waitUntilListening()
        } catch {
            stop()
            state = .failed(error.localizedDescription)
            throw error
        }

        let token = try await mintToken()
        state = .owned
        return token
    }

    /// Stops the child process if this controller started it. Attached servers
    /// are left alone.
    func stop() {
        guard let process else {
            state = .stopped
            return
        }
        self.process = nil
        if process.isRunning {
            process.terminate()
            let deadline = Date().addingTimeInterval(3)
            while process.isRunning, Date() < deadline {
                usleep(100_000)
            }
            if process.isRunning {
                kill(process.processIdentifier, SIGKILL)
            }
        }
        try? logHandle?.close()
        logHandle = nil
        state = .stopped
    }

    static func terminateCurrent() {
        current?.stop()
    }

    // MARK: - Spawning

    private func spawn() throws -> Process {
        let entry = Self.serverEntry
        guard FileManager.default.fileExists(atPath: entry) else {
            throw ServerError.entryMissing(entry)
        }
        try? FileManager.default.createDirectory(
            atPath: baseDirectory,
            withIntermediateDirectories: true
        )

        let process = Process()
        process.executableURL = URL(fileURLWithPath: Self.nodeExecutable)
        process.arguments = [
            entry,
            "serve",
            "--port", String(baseURL.port ?? 4611),
            "--host", baseURL.host ?? "127.0.0.1",
            "--base-dir", baseDirectory,
        ]
        process.currentDirectoryURL = URL(fileURLWithPath: Self.repoRoot)

        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = Self.childPath()
        process.environment = environment

        let logURL = URL(fileURLWithPath: baseDirectory).appendingPathComponent("server.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let handle = try FileHandle(forWritingTo: logURL)
        logHandle = handle
        process.standardOutput = handle
        process.standardError = handle
        process.standardInput = FileHandle.nullDevice

        try process.run()
        return process
    }

    private func waitUntilListening() async throws {
        let deadline = Date().addingTimeInterval(40)
        while Date() < deadline {
            if await Self.isReachable(baseURL) {
                return
            }
            if let process, !process.isRunning {
                throw ServerError.exitedEarly
            }
            try? await Task.sleep(for: .milliseconds(400))
        }
        throw ServerError.timedOut
    }

    private func mintToken() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: Self.nodeExecutable)
            process.arguments = [
                Self.serverEntry,
                "auth", "session", "issue",
                "--base-dir", baseDirectory,
                "--token-only",
            ]
            process.currentDirectoryURL = URL(fileURLWithPath: Self.repoRoot)

            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = Self.childPath()
            process.environment = environment

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = FileHandle.nullDevice

            process.terminationHandler = { _ in
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(decoding: data, as: UTF8.self)
                let token = output
                    .split(separator: "\n")
                    .map(String.init)
                    .first { $0.hasPrefix("eyJ") } ?? ""
                if token.isEmpty {
                    continuation.resume(throwing: ServerError.tokenFailed)
                } else {
                    continuation.resume(returning: token)
                }
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Reachability

    static func isReachable(_ url: URL) async -> Bool {
        var request = URLRequest(url: url)
        request.timeoutInterval = 1
        request.httpMethod = "GET"
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 1
        let session = URLSession(configuration: configuration)
        do {
            _ = try await session.data(for: request)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Locations

    static func defaultBaseDirectory() -> String {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("FourSpace/server").path
    }

    /// Repo root derived from this source file, so a dev build can find the
    /// server without configuration. Shipping builds set `FOURSPACE_SERVER_ENTRY`.
    private static var repoRoot: String {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // Server
            .deletingLastPathComponent() // FourspaceNative
            .deletingLastPathComponent() // Sources
            .deletingLastPathComponent() // macos
            .deletingLastPathComponent() // repo root
            .path
    }

    static var serverEntry: String {
        if let value = ProcessInfo.processInfo.environment["FOURSPACE_SERVER_ENTRY"], !value.isEmpty {
            return value
        }
        if let value = UserDefaults.standard.string(forKey: "fourspace.serverEntry"), !value.isEmpty {
            return value
        }
        return URL(fileURLWithPath: repoRoot).appendingPathComponent("apps/server/src/bin.ts").path
    }

    static var nodeExecutable: String {
        if let value = ProcessInfo.processInfo.environment["FOURSPACE_NODE"], !value.isEmpty {
            return value
        }
        let home = NSHomeDirectory()
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "\(home)/.local/share/vite-plus/bin/node",
            "\(home)/.local/bin/node",
            "/usr/bin/node",
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/local/bin/node"
    }

    private static func childPath() -> String {
        let home = NSHomeDirectory()
        let nodeDirectory = URL(fileURLWithPath: nodeExecutable).deletingLastPathComponent().path
        let entries = [
            nodeDirectory,
            "\(home)/.local/bin",
            "\(home)/.local/share/vite-plus/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        return entries.joined(separator: ":")
    }
}

enum ServerError: Error, LocalizedError {
    case entryMissing(String)
    case exitedEarly
    case timedOut
    case tokenFailed
    case notLocal(String)

    var errorDescription: String? {
        switch self {
        case .entryMissing(let path):
            return "T3 server entry not found at \(path). Set FOURSPACE_SERVER_ENTRY."
        case .exitedEarly:
            return "The T3 server exited before it started listening."
        case .timedOut:
            return "Timed out waiting for the T3 server to start."
        case .tokenFailed:
            return "Could not mint a bearer token for the T3 server."
        case .notLocal(let host):
            return "No server is running at \(host), and only a local server can be started automatically."
        }
    }
}
