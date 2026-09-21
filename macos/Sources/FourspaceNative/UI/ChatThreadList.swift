import SwiftUI

/// Middle-column list of the user's chats, driven by the live shell.
struct ChatThreadList: View {
    @Environment(ChatViewModel.self) private var chat

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Chats")
                    .font(.headline)
                Spacer()
                Button {
                    Task { await chat.newChat() }
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .buttonStyle(.borderless)
                .disabled(chat.connectionState != .connected)
                .help("New Chat")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            List(selection: selection) {
                switch chat.connectionState {
                case .connected where chat.threads.isEmpty:
                    Text("No chats yet.")
                        .foregroundStyle(.secondary)
                case .connected:
                    ForEach(chat.threads, id: \.id) { thread in
                        row(thread)
                    }
                default:
                    Text("Connect to a T3 server to see chats.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Chat")
    }

    private func row(_ thread: T3ThreadShell) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(thread.title)
                .lineLimit(1)
            if !relativeTime(thread.updatedAt).isEmpty {
                Text(relativeTime(thread.updatedAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .tag(thread.id)
    }

    private var selection: Binding<String?> {
        Binding(
            get: { chat.activeThreadId },
            set: { newValue in
                if let id = newValue {
                    chat.selectThread(id)
                }
            }
        )
    }

    private func relativeTime(_ iso: String) -> String {
        guard let date = Self.parse(iso) else { return "" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private static func parse(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }
}
