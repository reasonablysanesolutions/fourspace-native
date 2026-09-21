import SwiftUI

/// Compact usage indicator pinned to the bottom of the rail: today's cost in
/// SEK, cache hit rate, and OpenRouter's day. Discreet but always reachable.
struct RailUsageBar: View {
    @Environment(UsageViewModel.self) private var usage

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "chart.bar.xaxis")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("Today")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(usage.sek(usage.today.costUsd))
                    .font(.caption.monospacedDigit())
            }
            HStack(spacing: 6) {
                Text("\(usage.today.totalTokens.formatted(.number.notation(.compactName))) tokens")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("cache \(Int(usage.today.cacheHitPercent))%")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let openRouter = usage.openRouter, openRouter.status == "configured" {
                HStack(spacing: 6) {
                    Text("OpenRouter")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(usage.usd(openRouter.todayCostUsd))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}
