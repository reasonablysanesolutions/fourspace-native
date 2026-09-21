import Foundation

enum T3RpcError: Error, LocalizedError {
    case notConnected
    case encoding
    case transport(String)
    case server(JSONValue)

    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "Not connected to a T3 server."
        case .encoding:
            return "Could not encode a T3 request."
        case .transport(let message):
            return message
        case .server(let exit):
            if let reason = exit["cause"]?[0]?["error"] {
                return reason["message"]?.stringValue ?? String(describing: reason)
            }
            return String(describing: exit)
        }
    }
}

/// A minimal client for Effect RPC over WebSocket, using the JSON serialization
/// (`RpcSerialization.layerJson`): one JSON envelope per WebSocket text frame.
///
/// Envelopes used here:
///   client → server  `{"_tag":"Request","id":…,"tag":…,"payload":…,"headers":[]}`
///                    `{"_tag":"Ack","requestId":…}`
///                    `{"_tag":"Interrupt","requestId":…}`
///   server → client  `{"_tag":"Chunk","requestId":…,"values":[…]}`
///                    `{"_tag":"Exit","requestId":…,"exit":{…}}`
///                    `{"_tag":"Defect","defect":…}` / `{"_tag":"Pong"}`
///
/// Streaming responses require the client to `Ack` each chunk; the server
/// holds the next chunk behind a latch until it arrives.
actor T3RpcClient {
    private let baseURL: URL
    private let token: String?

    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?

    private var unary: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var streams: [String: AsyncThrowingStream<JSONValue, Error>.Continuation] = [:]

    init(baseURL: URL, token: String?) {
        self.baseURL = baseURL
        self.token = token
    }

    // MARK: - Connection

    func connect() async throws {
        await disconnect()

        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw T3RpcError.transport("Invalid server URL: \(baseURL)")
        }
        components.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        if components.path.isEmpty || components.path == "/" {
            components.path = "/ws"
        }
        guard let url = components.url else {
            throw T3RpcError.transport("Invalid server URL: \(baseURL)")
        }

        var request = URLRequest(url: url)
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration)
        let task = session.webSocketTask(with: request)

        self.session = session
        self.task = task
        task.resume()
        startReceiveLoop()
    }

    func disconnect() async {
        receiveTask?.cancel()
        receiveTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
        failAll(T3RpcError.notConnected)
    }

    // MARK: - Requests

    nonisolated func request(tag: String, payload: JSONValue) async throws -> JSONValue {
        let id = UUID().uuidString
        return try await withCheckedThrowingContinuation { continuation in
            Task {
                await self.registerUnary(id: id, continuation: continuation)
                do {
                    try await self.sendRequest(id: id, tag: tag, payload: payload)
                } catch {
                    await self.failUnary(id: id, error: error)
                }
            }
        }
    }

    nonisolated func stream(tag: String, payload: JSONValue) -> AsyncThrowingStream<JSONValue, Error> {
        let id = UUID().uuidString
        return AsyncThrowingStream { continuation in
            Task {
                await self.registerStream(id: id, continuation: continuation)
                do {
                    try await self.sendRequest(id: id, tag: tag, payload: payload)
                } catch {
                    await self.finishStream(id: id, error: error)
                }
            }
        }
    }

    // MARK: - Actor state

    private func registerUnary(id: String, continuation: CheckedContinuation<JSONValue, Error>) {
        unary[id] = continuation
    }

    private func registerStream(
        id: String,
        continuation: AsyncThrowingStream<JSONValue, Error>.Continuation
    ) {
        streams[id] = continuation
        continuation.onTermination = { [weak self] _ in
            guard let self else { return }
            Task { await self.interrupt(id: id) }
        }
    }

    private func failUnary(id: String, error: Error) {
        unary.removeValue(forKey: id)?.resume(throwing: error)
    }

    private func finishStream(id: String, error: Error) {
        streams.removeValue(forKey: id)?.finish(throwing: error)
    }

    private func interrupt(id: String) {
        guard streams[id] != nil else { return }
        streams[id] = nil
        Task { try? await self.send(.object(["_tag": .string("Interrupt"), "requestId": .string(id)])) }
    }

    private func failAll(_ error: Error) {
        let pendingUnary = unary
        unary.removeAll()
        for (_, continuation) in pendingUnary {
            continuation.resume(throwing: error)
        }
        let pendingStreams = streams
        streams.removeAll()
        for (_, continuation) in pendingStreams {
            continuation.finish(throwing: error)
        }
    }

    private func sendRequest(id: String, tag: String, payload: JSONValue) async throws {
        try await send(.object([
            "_tag": .string("Request"),
            "id": .string(id),
            "tag": .string(tag),
            "payload": payload,
            "headers": .array([]),
        ]))
    }

    private func sendAck(id: String) async {
        try? await send(.object(["_tag": .string("Ack"), "requestId": .string(id)]))
    }

    private func send(_ message: JSONValue) async throws {
        guard let task else { throw T3RpcError.notConnected }
        let data = try JSONEncoder().encode(message)
        guard let text = String(data: data, encoding: .utf8) else { throw T3RpcError.encoding }
        try await task.send(.string(text))
    }

    // MARK: - Receive

    private func startReceiveLoop() {
        receiveTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, let task = await self.task else { break }
                do {
                    let message = try await task.receive()
                    switch message {
                    case .string(let text):
                        await self.handle(text)
                    case .data(let data):
                        await self.handle(String(decoding: data, as: UTF8.self))
                    @unknown default:
                        break
                    }
                } catch {
                    await self.handleDisconnect(error)
                    break
                }
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            return
        }

        switch message["_tag"]?.stringValue {
        case "Chunk":
            guard let id = message["requestId"]?.idString, let continuation = streams[id] else { return }
            for value in message["values"]?.arrayValue ?? [] {
                continuation.yield(value)
            }
            Task { await self.sendAck(id: id) }

        case "Exit":
            guard let id = message["requestId"]?.idString else { return }
            let exit = message["exit"]
            let succeeded = exit?["_tag"]?.stringValue == "Success"
            if let continuation = streams.removeValue(forKey: id) {
                if succeeded {
                    continuation.finish()
                } else {
                    continuation.finish(throwing: T3RpcError.server(exit ?? .null))
                }
            } else if let continuation = unary.removeValue(forKey: id) {
                if succeeded {
                    continuation.resume(returning: exit?["value"] ?? .null)
                } else {
                    continuation.resume(throwing: T3RpcError.server(exit ?? .null))
                }
            }

        case "Defect":
            failAll(T3RpcError.server(message["defect"] ?? .null))

        default:
            break
        }
    }

    private func handleDisconnect(_ error: Error) {
        task = nil
        failAll(T3RpcError.transport(error.localizedDescription))
    }
}
