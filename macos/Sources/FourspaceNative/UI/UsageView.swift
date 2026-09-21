import SwiftUI

/// Full usage view: local provider usage for today, OpenRouter analytics, and
/// top models. Costs are shown in SEK alongside the raw USD figure.
struct UsageView: View {
    @Environment(UsageViewModel.self) private var usage
    @Environment(HarnessStore.self) private var harness

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                today
                openRouterSection
                modelsSection
                footer
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Usage")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await usage.load(harness: harness) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(usage.isLoading)
            }
        }
    }

    private var today: some View {
        card("Today") {
            metric("Cost", usage.sek(usage.today.costUsd), detail: usage.usd(usage.today.costUsd))
            metric("Tokens", usage.today.totalTokens.formatted(), detail: "\(usage.today.inputTotal) in · \(usage.today.output) out")
            metric("Cache", "\(Int(usage.today.cacheHitPercent))%", detail: "saved \(usage.sek(usage.today.cacheSavingsUsd))")
            metric("Responses", usage.today.records.formatted(), detail: nil)
        }
    }

    @ViewBuilder
    private var openRouterSection: some View {
        card("OpenRouter") {
            if let openRouter = usage.openRouter {
                switch openRouter.status {
                case "configured":
                    metric("Today", usage.usd(openRouter.todayCostUsd), detail: usage.sek(openRouter.todayCostUsd))
                    metric("7 days", usage.usd(openRouter.last7CostUsd), detail: usage.sek(openRouter.last7CostUsd))
                    metric("30 days", usage.usd(openRouter.last30CostUsd), detail: usage.sek(openRouter.last30CostUsd))
                    if let label = openRouter.keyLabel {
                        Text("Key: \(label)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                case "error":
                    Text(openRouter.error ?? "OpenRouter error.")
                        .foregroundStyle(.orange)
                default:
                    Text("No OpenRouter key configured. Add one in Settings.")
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("OpenRouter not loaded.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var modelsSection: some View {
        if !usage.topModels.isEmpty {
            card("Top models today") {
                ForEach(usage.topModels.prefix(8), id: \.model) { model in
                    HStack {
                        Text(model.model)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                        Text(usage.usd(model.costUsd))
                            .font(.callout.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if let pricing = usage.pricingStatus {
            Text("Pricing: \(pricing)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        if let error = usage.errorText {
            Text(error)
                .font(.callout)
                .foregroundStyle(.red)
        }
        HStack {
            Text("USD → SEK rate")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Rate", value: Bindable(usage).usdSekRate, format: .number)
                .textFieldStyle(.roundedBorder)
                .frame(width: 80)
        }
    }

    // MARK: - Building blocks

    private func card<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.secondary.opacity(0.06))
        )
    }

    private func metric(_ label: String, _ value: String, detail: String?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(value)
                    .font(.body.monospacedDigit())
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
