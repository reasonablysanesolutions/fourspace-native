import AppKit
import SwiftUI

/// Settings: the Four Space root, costs, the server, providers and OpenRouter.
struct SettingsView: View {
    @Environment(HarnessStore.self) private var harness
    @Environment(FourSpacesRegistry.self) private var registry
    @Environment(UsageViewModel.self) private var usage

    @State private var openRouterKey = ""
    @State private var keyStatus: String?

    var body: some View {
        Form {
            Section("Four Space") {
                LabeledContent("Root") {
                    Text(registry.resolvedDefaultRoot)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundStyle(.secondary)
                }
                Button("Change Root…", action: chooseRoot)
                TextField("USD → SEK rate", value: Bindable(usage).usdSekRate, format: .number)
            }

            Section("Server") {
                LabeledContent("URL", value: harness.serverURL)
                LabeledContent("Status", value: statusText)
                if harness.serverController?.isOwned == true {
                    Text("This app started the server; it stops when the app quits.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Button("Disconnect") { Task { await harness.disconnect() } }
                        .disabled(!harness.isConnected)
                    Button("Reconnect") { Task { await harness.connect() } }
                }
            }

            Section("Providers") {
                if harness.providers.isEmpty {
                    Text("No providers reported.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(harness.providers) { provider in
                        HStack {
                            Text(provider.label)
                            Spacer()
                            Text("\(provider.models.count) models")
                                .foregroundStyle(.secondary)
                            Text(provider.status)
                                .font(.caption)
                                .foregroundStyle(provider.isReady ? .green : .secondary)
                        }
                    }
                }
            }

            Section("OpenRouter") {
                if let openRouter = usage.openRouter, openRouter.status == "configured" {
                    LabeledContent("Status", value: "Configured")
                    if let label = openRouter.keyLabel {
                        LabeledContent("Key", value: label)
                    }
                    LabeledContent("Today", value: usage.usd(openRouter.todayCostUsd))
                } else {
                    Text("No key configured.")
                        .foregroundStyle(.secondary)
                }
                SecureField("API key", text: $openRouterKey)
                HStack {
                    Button("Save Key") {
                        Task {
                            do {
                                try await harness.setOpenRouterKey(openRouterKey)
                                openRouterKey = ""
                                keyStatus = "Saved."
                                await usage.load(harness: harness)
                            } catch {
                                keyStatus = error.localizedDescription
                            }
                        }
                    }
                    .disabled(openRouterKey.isEmpty)
                    Button("Clear Key") {
                        Task {
                            try? await harness.clearOpenRouterKey()
                            keyStatus = "Cleared."
                            await usage.load(harness: harness)
                        }
                    }
                }
                if let keyStatus {
                    Text(keyStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
    }

    private var statusText: String {
        switch harness.connectionState {
        case .connected: "Connected"
        case .connecting: "Connecting…"
        case .failed(let message): message
        case .disconnected: "Not connected"
        }
    }

    private func chooseRoot() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Use as Root"
        panel.message = "New workspaces go in its Experiments, Projects and Products folders."
        if panel.runModal() == .OK, let url = panel.url {
            registry.defaultRoot = url.path
            registry.save()
        }
    }
}
