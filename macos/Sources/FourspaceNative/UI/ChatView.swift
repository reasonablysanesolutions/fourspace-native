import SwiftUI

struct ChatView: View {
    @Environment(ChatViewModel.self) private var chat

    var body: some View {
        @Bindable var chat = chat
        VStack(spacing: 0) {
            header
            Divider()
            if chat.connectionState == .connected {
                transcript
                Divider()
                composer
            } else {
                connectForm
            }
        }
        .navigationTitle("Chat")
        .task {
            if chat.connectionState == .disconnected {
                await chat.connect()
            }
        }
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
                modelPicker
                Button("Disconnect") {
                    Task { await chat.disconnect() }
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

    private var modelPicker: some View {
        @Bindable var chat = chat
        return Menu {
            ForEach(chat.availableProviders) { provider in
                Section(provider.label) {
                    ForEach(provider.models) { model in
                        Button {
                            chat.selectModel(provider: provider, model: model)
                        } label: {
                            if provider.instanceId == chat.selectedProviderId, model.slug == chat.selectedModelSlug {
                                Label(model.name, systemImage: "checkmark")
                            } else {
                                Text(model.name)
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(modelLabel)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
            }
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
    }

    private var modelLabel: String {
        guard let model = chat.selectedModel else { return "Select model" }
        let provider = chat.selectedProvider?.label
        return provider.map { "\(model.name) · \($0)" } ?? model.name
    }

    // MARK: - Connect form

    private var connectForm: some View {
        @Bindable var chat = chat
        return VStack(spacing: 14) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 40))
                .foregroundStyle(.blue)
            Text("Connect to a T3 server")
                .font(.title3.weight(.semibold))
            Text("Four Space starts a local T3 server automatically. Point at a remote server only if you need to.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)

            TextField("Server URL", text: $chat.serverURL)
                .textFieldStyle(.roundedBorder)
                .frame(width: 340)
            SecureField("Bearer token (remote servers)", text: $chat.token)
                .textFieldStyle(.roundedBorder)
                .frame(width: 340)

            Button {
                Task { await chat.connect() }
            } label: {
                Text("Connect").frame(width: 120)
            }
            .buttonStyle(.borderedProminent)
            .disabled(chat.connectionState == .connecting)

            if chat.connectionState == .connecting {
                ProgressView().controlSize(.small)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Transcript

    private var transcript: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(chat.messages) { message in
                    messageRow(message)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .defaultScrollAnchor(.bottom)
    }

    private func messageRow(_ message: ChatMessage) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(roleLabel(message.role))
                .font(.caption.weight(.semibold))
                .foregroundStyle(roleColor(message.role))
            Text(message.text.isEmpty && message.streaming ? "…" : message.text)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(message.role == "user" ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.08))
        )
    }

    private func roleLabel(_ role: String) -> String {
        switch role {
        case "user": "You"
        case "assistant": "Assistant"
        case "reasoning": "Reasoning"
        default: role.capitalized
        }
    }

    private func roleColor(_ role: String) -> Color {
        switch role {
        case "user": .accentColor
        case "assistant": .primary
        default: .secondary
        }
    }

    // MARK: - Composer

    private var composer: some View {
        @Bindable var chat = chat
        return VStack(alignment: .leading, spacing: 8) {
            if let error = chat.errorText {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Ask anything…", text: $chat.draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .onSubmit { Task { await chat.send() } }
                Button {
                    Task { await chat.send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .buttonStyle(.plain)
                .disabled(!chat.canSend)
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .padding(12)
    }
}
