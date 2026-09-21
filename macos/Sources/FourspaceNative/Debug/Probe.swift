import Foundation

/// Headless round-trip against a T3 server. Reads configuration from the
/// environment so it never hardcodes a credential:
///   FOURSPACE_URL    e.g. http://127.0.0.1:4611
///   FOURSPACE_TOKEN  bearer token issued by `t3 auth session issue --token-only`
///   FOURSPACE_PROMPT optional prompt (defaults to a trivial one)
enum Probe {
    /// Unbuffered diagnostic output so a killed probe still shows progress.
    static func log(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }

    static func run() async {
        let environment = ProcessInfo.processInfo.environment
        guard let urlString = environment["FOURSPACE_URL"], let url = URL(string: urlString) else {
            log("probe: FOURSPACE_URL is required")
            return
        }
        let token = environment["FOURSPACE_TOKEN"]
        let prompt = environment["FOURSPACE_PROMPT"] ?? "Reply with exactly: fourspace-probe-ok"

        let connection = T3Connection(baseURL: url, token: token)
        do {
            log("probe: connecting to \(urlString)")
            try await connection.connect()
            let config = try await connection.loadConfig()
            log("probe: environment \(config.environmentId), cwd \(config.cwd)")

            // Relocation-only mode: verify the cross-volume-safe move/copy RPC.
            if let source = environment["FOURSPACE_PROBE_RELOCATE"],
               let destination = environment["FOURSPACE_PROBE_DEST"] {
                let mode = environment["FOURSPACE_PROBE_MODE"] ?? "move"
                let result = try await connection.relocateWorkspace(
                    sourcePath: source,
                    destinationPath: destination,
                    mode: mode
                )
                log("probe: relocated \(source) -> \(result) (\(mode))")
                await connection.disconnect()
                return
            }

            // Notes mode: read + append + write NOTES.md in a workspace.
            if let cwd = environment["FOURSPACE_PROBE_NOTES"] {
                var before: String?
                do { before = try await connection.readFile(cwd: cwd, relativePath: "NOTES.md") } catch {
                    before = nil
                    log("probe: notes read error = \(error.localizedDescription)")
                    if let entries = try? await connection.listEntryPaths(cwd: cwd) {
                        let names = entries.prefix(5).map { "\($0.path)(\($0.kind))" }.joined(separator: ", ")
                        log("probe: entries = [\(names)]")
                        log("probe: notes present = \(entries.contains { $0.kind == "file" && $0.path.lowercased() == "notes.md" })")
                    }
                }
                log("probe: notes before = \(before.map { "\($0.count) chars" } ?? "<missing>")")
                let updated = (before ?? "") + "\nnotes-probe-\(Int(Date().timeIntervalSince1970))\n"
                try await connection.writeFile(cwd: cwd, relativePath: "NOTES.md", contents: updated)
                let after = try await connection.readFile(cwd: cwd, relativePath: "NOTES.md")
                log("probe: notes after = \(after.count) chars")
                await connection.disconnect()
                return
            }

            // Usage mode: verify the usage + OpenRouter RPCs.
            if environment["FOURSPACE_PROBE_USAGE"] != nil {
                let formatter = DateFormatter()
                formatter.dateFormat = "yyyy-MM-dd"
                let day = formatter.string(from: Date())
                let summary = try await connection.request(tag: "server.getUsageSummary", payload: .object([
                    "sinceDay": .string(day),
                    "untilDay": .string(day),
                    "timeZone": .string(TimeZone.current.identifier),
                    "resolution": .string("day"),
                ]))
                log("probe: usage buckets = \(summary["buckets"]?.arrayValue?.count ?? -1), pricing = \(summary["pricing"]?["status"]?.stringValue ?? "?")")
                let openRouter = try await connection.request(tag: "fourspaces.getOpenRouterUsage", payload: .object([:]))
                log("probe: openrouter status = \(openRouter["status"]?.stringValue ?? "?")")
                await connection.disconnect()
                return
            }

            let providers = config.providers.filter { $0.isReady && !$0.models.isEmpty }
            guard let provider = providers.first, let model = provider.models.first else {
                log("probe: no ready provider with models")
                return
            }
            log("probe: provider \(provider.instanceId) model \(model.slug)")

            let root = (NSHomeDirectory() as NSString).appendingPathComponent("FourSpace/Chat")
            let opened = try await connection.openOrCreateWorkspace(
                workspaceRoot: root,
                projectTitle: "Chat",
                threadTitle: "Probe",
                modelSelection: T3Connection.modelSelection(provider: provider, model: model)
            )
            log("probe: project \(opened.projectId) thread \(opened.threadId)")
            let threadId = opened.threadId

            var accumulated = ""
            let stream = connection.subscribeThread(threadId: threadId)
            try await Task.sleep(for: .milliseconds(250))

            try await connection.startTurn(
                threadId: threadId,
                text: prompt,
                modelSelection: T3Connection.modelSelection(provider: provider, model: model)
            )
            log("probe: turn started")

            let deadline = Date().addingTimeInterval(120)
            do {
                outer: for try await item in stream {
                    switch item["kind"]?.stringValue {
                    case "snapshot":
                        let messages = item["snapshot"]?["thread"]?["messages"]?.arrayValue ?? []
                        if let last = messages.last(where: { $0["role"]?.stringValue == "assistant" }) {
                            accumulated = last["text"]?.stringValue ?? accumulated
                        }
                        log("probe: snapshot with \(messages.count) messages")
                    case "event":
                        guard let event = item["event"],
                              event["type"]?.stringValue == "thread.message-sent",
                              let payload = event["payload"],
                              payload["role"]?.stringValue == "assistant" else { continue }
                        let text = payload["text"]?.stringValue ?? ""
                        if payload["streaming"]?.boolValue == true {
                            accumulated += text
                        } else if !text.isEmpty {
                            accumulated = text
                        } else {
                            log("probe: assistant complete")
                            break outer
                        }
                    default:
                        break
                    }
                    if Date() > deadline {
                        log("probe: deadline reached")
                        break outer
                    }
                }
            } catch {
                log("probe: stream error \(error.localizedDescription)")
            }

            log("probe: assistant text >>> \(accumulated)")
            await connection.disconnect()
        } catch {
            log("probe: failed: \(error.localizedDescription)")
        }
    }
}
