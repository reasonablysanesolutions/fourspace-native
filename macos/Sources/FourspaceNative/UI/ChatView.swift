import SwiftUI

struct ChatView: View {
    @Environment(ChatViewModel.self) private var chat

    var body: some View {
        @Bindable var chat = chat
        VStack(spacing: 0) {
            header
            Divider()
            if chat.connectionState == .connected {
                MessageList(messages: chat.messages)
                Divider()
                Composer(text: $chat.draft, canSend: chat.canSend, errorText: chat.errorText) {
                    Task { await chat.send() }
                }
            } else {
                HarnessConnectView {
                    Task { await chat.connect() }
                }
            }
        }
        .navigationTitle("Chat")
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
            Text(statusText)
                .font(.callout)
                .foregroundStyle(.secondary)
            Spacer()
            if chat.connectionState == .connected {
                Button {
                    Task { await chat.newChat() }
                } label: {
                    Label("New Chat", systemImage: "square.and.pencil")
                }
                .controlSize(.small)
                ModelPicker()
                Button("Disconnect") {
                    Task { await chat.harness.disconnect() }
                }
                .controlSize(.small)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var statusColor: Color {
        switch chat.connectionState {
        case .connected: .green
        case .connecting: .orange
        case .failed: .red
        case .disconnected: .secondary
        }
    }

    private var statusText: String {
        switch chat.connectionState {
        case .connected:
            return chat.serverController?.isOwned == true ? "Connected · local server" : "Connected"
        case .connecting:
            if chat.serverController?.state == .starting {
                return "Starting T3 server…"
            }
            return "Connecting…"
        case .failed(let message):
            return message
        case .disconnected:
            return "Not connected"
        }
    }
}
