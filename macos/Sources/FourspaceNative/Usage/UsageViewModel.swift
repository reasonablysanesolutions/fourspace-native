import Foundation

struct UsageTotals: Sendable {
    var costUsd: Double = 0
    var cacheSavingsUsd: Double = 0
    var uncachedInput = 0
    var cachedInput = 0
    var cacheCreation = 0
    var output = 0
    var reasoning = 0
    var records = 0

    var inputTotal: Int { uncachedInput + cachedInput + cacheCreation }
    var totalTokens: Int { inputTotal + output }

    var cacheHitPercent: Double {
        guard inputTotal > 0 else { return 0 }
        return Double(cachedInput) / Double(inputTotal) * 100
    }

    mutating func add(_ bucket: JSONValue) {
        let totals = bucket["totals"]
        uncachedInput += totals?["uncachedInputTokens"]?.intValue ?? 0
        cachedInput += totals?["cachedInputTokens"]?.intValue ?? 0
        cacheCreation += totals?["cacheCreationTokens"]?.intValue ?? 0
        output += totals?["outputTokens"]?.intValue ?? 0
        reasoning += totals?["reasoningTokens"]?.intValue ?? 0
        costUsd += bucket["costUsd"]?.doubleValue ?? 0
        cacheSavingsUsd += bucket["cacheSavingsUsd"]?.doubleValue ?? 0
        records += bucket["records"]?.intValue ?? 0
    }
}

struct OpenRouterUsage: Sendable {
    var status: String = "unconfigured"
    var keyLabel: String?
    var todayCostUsd: Double = 0
    var last7CostUsd: Double = 0
    var last30CostUsd: Double = 0
    var todayRequests: Int = 0
    var todayInput: Int = 0
    var todayOutput: Int = 0
    var todayCached: Int = 0
    var models: [OpenRouterModel] = []
    var error: String?

    struct OpenRouterModel: Sendable, Identifiable {
        var id: String { model }
        let model: String
        let costUsd: Double
    }

    init(json: JSONValue) {
        status = json["status"]?.stringValue ?? "unconfigured"
        keyLabel = json["keyLabel"]?.stringValue
        todayCostUsd = json["today"]?["costUsd"]?.doubleValue ?? 0
        last7CostUsd = json["last7Days"]?["costUsd"]?.doubleValue ?? 0
        last30CostUsd = json["last30Days"]?["costUsd"]?.doubleValue ?? 0
        todayRequests = json["today"]?["requests"]?.intValue ?? 0
        todayInput = json["today"]?["inputTokens"]?.intValue ?? 0
        todayOutput = json["today"]?["outputTokens"]?.intValue ?? 0
        todayCached = json["today"]?["cachedTokens"]?.intValue ?? 0
        error = json["error"]?.stringValue
        models = (json["models"]?.arrayValue ?? []).compactMap { model in
            guard let name = model["model"]?.stringValue else { return nil }
            return OpenRouterModel(model: name, costUsd: model["costUsd"]?.doubleValue ?? 0)
        }
    }
}

/// Loads usage for the local day plus OpenRouter analytics, and converts costs
/// to SEK for display.
@MainActor
@Observable
final class UsageViewModel {
    var today = UsageTotals()
    var last7 = UsageTotals()
    var openRouter: OpenRouterUsage?
    var pricingStatus: String?
    var topModels: [(model: String, costUsd: Double, tokens: Int)] = []
    var isLoading = false
    var errorText: String?

    /// USD → SEK. Editable in Settings; a plain stored rate keeps the app
    /// offline-friendly.
    var usdSekRate: Double {
        get { UserDefaults.standard.object(forKey: "fourspace.usdSekRate") as? Double ?? 10.5 }
        set { UserDefaults.standard.set(newValue, forKey: "fourspace.usdSekRate") }
    }

    func load(harness: HarnessStore) async {
        guard harness.isConnected else { return }
        isLoading = true
        errorText = nil
        defer { isLoading = false }

        let zone = TimeZone.current.identifier
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        let todayString = formatter.string(from: Date())

        do {
            let summary = try await harness.usageSummary(
                sinceDay: todayString,
                untilDay: todayString,
                timeZone: zone
            )
            apply(summary: summary)
        } catch {
            errorText = error.localizedDescription
        }

        // OpenRouter is optional: an unconfigured key is not an error.
        if let json = try? await harness.openRouterUsage() {
            openRouter = OpenRouterUsage(json: json)
        }
    }

    private func apply(summary: JSONValue) {
        var day = UsageTotals()
        var week = UsageTotals()
        var byModel: [String: (cost: Double, tokens: Int)] = [:]
        let buckets = summary["buckets"]?.arrayValue ?? []
        for bucket in buckets {
            day.add(bucket)
            week.add(bucket)
            if let model = bucket["model"]?.stringValue {
                let existing = byModel[model] ?? (0, 0)
                let tokens = bucket["totals"]?["uncachedInputTokens"]?.intValue ?? 0
                    + (bucket["totals"]?["cachedInputTokens"]?.intValue ?? 0)
                    + (bucket["totals"]?["outputTokens"]?.intValue ?? 0)
                byModel[model] = (
                    existing.cost + (bucket["costUsd"]?.doubleValue ?? 0),
                    existing.tokens + tokens
                )
            }
        }
        today = day
        last7 = week
        pricingStatus = summary["pricing"]?["status"]?.stringValue
        topModels = byModel
            .map { (model: $0.key, costUsd: $0.value.cost, tokens: $0.value.tokens) }
            .sorted { $0.costUsd > $1.costUsd }
    }

    func sek(_ usd: Double) -> String {
        let value = usd * usdSekRate
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "SEK"
        formatter.locale = Locale(identifier: "sv_SE")
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f kr", value)
    }

    func usd(_ value: Double) -> String {
        String(format: "$%.2f", value)
    }
}
