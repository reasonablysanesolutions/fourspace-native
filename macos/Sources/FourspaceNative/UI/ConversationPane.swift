import SwiftUI

/// Shared transcript rendering for Chat and project threads.
struct MessageList: View {
    let messages: [ChatMessage]

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(messages) { message in
                    row(message)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .defaultScrollAnchor(.bottom)
    }

    private func row(_ message: ChatMessage) -> some View {
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
}

/// Shared composer for Chat and project threads.
struct Composer: View {
    @Binding var text: String
    let canSend: Bool
    let errorText: String?
    let onSend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let errorText {
                Text(errorText)
                    .font(.callout)
                    .foregroundStyle(.red)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Ask anything…", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .onSubmit(onSend)
                Button(action: onSend) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .padding(12)
    }
}
