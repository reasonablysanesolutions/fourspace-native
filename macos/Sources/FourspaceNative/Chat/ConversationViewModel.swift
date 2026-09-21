import Foundation

struct ChatMessage: Identifiable, Hashable, Sendable {
    let id: String
    var role: String
    var text: String
    var streaming: Bool
}

/// Streams one thread's transcript. Used by Chat and by a project's threads.
@MainActor
@Observable
final class ConversationViewModel {
    var messages: [ChatMessage] = []

    /// Called when an assistant message completes, so owners can refresh
    /// generated thread titles.
    var onAssistantComplete: (() -> Void)?

    private var streamTask: Task<Void, Never>?

    var isStreaming: Bool {
        messages.contains { $0.streaming }
    }

    func open(threadId: String, harness: HarnessStore) async {
        close()
        guard let stream = await harness.subscribeThread(threadId: threadId) else { return }
        streamTask = Task { [weak self] in
            do {
                for try await item in stream {
                    guard let self else { return }
                    self.handle(item)
                }
            } catch {
                // A dropped stream leaves the last transcript in place.
            }
        }
    }

    func close() {
        streamTask?.cancel()
        streamTask = nil
        messages = []
    }

    private func handle(_ item: JSONValue) {
        switch item["kind"]?.stringValue {
        case "snapshot":
            if let thread = item["snapshot"]?["thread"] {
                applySnapshot(thread)
            }
        case "event":
            guard let event = item["event"],
                  event["type"]?.stringValue == "thread.message-sent" else { return }
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

        if !streaming, role == "assistant" {
            onAssistantComplete?()
        }
    }
}
