import Foundation

enum ScheduledFrequency: String, CaseIterable, Identifiable, Sendable {
    case once
    case daily
    case weekly
    case interval

    var id: String { rawValue }

    var title: String {
        switch self {
        case .once: "Once"
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .interval: "Interval"
        }
    }
}

struct ScheduledSchedule: Sendable, Equatable {
    var kind: ScheduledFrequency = .daily
    var atIso: String?
    var weekday: Int?
    var hour: Int = 9
    var minute: Int = 0
    var intervalMinutes: Int = 60
    var timeZone: String = TimeZone.current.identifier

    init(kind: ScheduledFrequency = .daily) {
        self.kind = kind
    }

    init(json: JSONValue) {
        kind = ScheduledFrequency(rawValue: json["kind"]?.stringValue ?? "daily") ?? .daily
        atIso = json["atIso"]?.stringValue
        weekday = json["weekday"]?.intValue
        hour = json["hour"]?.intValue ?? 9
        minute = json["minute"]?.intValue ?? 0
        intervalMinutes = json["intervalMinutes"]?.intValue ?? 60
        timeZone = json["timeZone"]?.stringValue ?? TimeZone.current.identifier
    }

    var json: JSONValue {
        var object: [String: JSONValue] = [
            "kind": .string(kind.rawValue),
            "timeZone": .string(timeZone),
        ]
        switch kind {
        case .once:
            object["atIso"] = .string(atIso ?? ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600)))
        case .daily:
            object["hour"] = .number(Double(hour))
            object["minute"] = .number(Double(minute))
        case .weekly:
            object["weekday"] = .number(Double(weekday ?? 1))
            object["hour"] = .number(Double(hour))
            object["minute"] = .number(Double(minute))
        case .interval:
            object["intervalMinutes"] = .number(Double(intervalMinutes))
        }
        return .object(object)
    }

    var summary: String {
        switch kind {
        case .once:
            return "Once at \(Self.shortDate(atIso))"
        case .daily:
            return String(format: "Daily at %02d:%02d", hour, minute)
        case .weekly:
            return String(format: "Weekly %@ at %02d:%02d", Self.weekdayName(weekday ?? 1), hour, minute)
        case .interval:
            return "Every \(intervalMinutes) min"
        }
    }

    static func weekdayName(_ value: Int) -> String {
        let names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        return names.indices.contains(value) ? names[value] : "?"
    }

    static func shortDate(_ iso: String?) -> String {
        guard let iso else { return "—" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: iso) ?? {
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: iso)
        }()
        guard let date else { return iso }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

struct ScheduledJob: Identifiable, Sendable {
    let id: String
    let title: String
    let projectId: String
    let threadId: String?
    let prompt: String
    let enabled: Bool
    let schedule: ScheduledSchedule
    let nextRunAt: String?
    let lastRunAt: String?

    init(json: JSONValue) {
        id = json["id"]?.stringValue ?? UUID().uuidString
        title = json["title"]?.stringValue ?? "Untitled"
        projectId = json["projectId"]?.stringValue ?? ""
        threadId = json["threadId"]?.stringValue
        prompt = json["prompt"]?.stringValue ?? ""
        enabled = json["enabled"]?.boolValue ?? true
        schedule = ScheduledSchedule(json: json["schedule"] ?? .null)
        nextRunAt = json["nextRunAt"]?.stringValue
        lastRunAt = json["lastRunAt"]?.stringValue
    }

    var isRecurring: Bool { schedule.kind != .once }
}

struct ScheduledRun: Identifiable, Sendable {
    let id: String
    let jobId: String
    let threadId: String?
    let startedAt: String
    let finishedAt: String?
    let status: String
    let error: String?

    init(json: JSONValue) {
        id = json["id"]?.stringValue ?? UUID().uuidString
        jobId = json["jobId"]?.stringValue ?? ""
        threadId = json["threadId"]?.stringValue
        startedAt = json["startedAt"]?.stringValue ?? ""
        finishedAt = json["finishedAt"]?.stringValue
        status = json["status"]?.stringValue ?? "completed"
        error = json["error"]?.stringValue
    }
}
