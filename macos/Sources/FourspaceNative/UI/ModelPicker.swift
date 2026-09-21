import SwiftUI

/// Provider/model picker bound to the shared harness selection.
struct ModelPicker: View {
    @Environment(HarnessStore.self) private var harness

    var body: some View {
        Menu {
            ForEach(harness.availableProviders) { provider in
                Section(provider.label) {
                    ForEach(provider.models) { model in
                        Button {
                            harness.selectModel(provider: provider, model: model)
                        } label: {
                            if provider.instanceId == harness.selectedProviderId,
                               model.slug == harness.selectedModelSlug {
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
                Text(label)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
            }
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
    }

    private var label: String {
        guard let model = harness.selectedModel else { return "Select model" }
        let provider = harness.selectedProvider?.label
        return provider.map { "\(model.name) · \($0)" } ?? model.name
    }
}
