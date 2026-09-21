import SwiftUI

/// Shared connect form, shown when no server is reachable.
struct HarnessConnectView: View {
    @Environment(HarnessStore.self) private var harness
    let onConnect: () -> Void

    var body: some View {
        @Bindable var harness = harness
        VStack(spacing: 14) {
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

            TextField("Server URL", text: $harness.serverURL)
                .textFieldStyle(.roundedBorder)
                .frame(width: 340)
            SecureField("Bearer token (remote servers)", text: $harness.token)
                .textFieldStyle(.roundedBorder)
                .frame(width: 340)

            Button(action: onConnect) {
                Text("Connect").frame(width: 120)
            }
            .buttonStyle(.borderedProminent)
            .disabled(harness.connectionState == .connecting)

            if harness.connectionState == .connecting {
                ProgressView().controlSize(.small)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
