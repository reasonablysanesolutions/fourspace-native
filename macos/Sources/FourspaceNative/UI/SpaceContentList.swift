import SwiftUI

/// Middle column. Contents depend on the selected space.
struct SpaceContentList: View {
    let selection: RailSelection?

    var body: some View {
        Group {
            switch selection {
            case .space(.chat):
                ChatThreadList()
            case .space(let space):
                ProjectsList(space: space)
            case .global(.scheduled):
                ScheduledPlaceholder()
            case .global(.usage):
                UsagePlaceholder()
            case .global(.settings):
                SettingsPlaceholder()
            case nil:
                ContentUnavailableView(
                    "Nothing selected",
                    systemImage: "sidebar.left"
                )
            }
        }
        .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 420)
    }
}

private struct UsagePlaceholder: View {
    var body: some View {
        List {
            Text("Today, OpenRouter and top models.")
                .foregroundStyle(.secondary)
        }
        .navigationTitle("Usage")
    }
}

private struct ScheduledPlaceholder: View {
    var body: some View {
        List {
            Section("Upcoming") { Text("No upcoming jobs.").foregroundStyle(.secondary) }
            Section("Recurring") { Text("No recurring jobs.").foregroundStyle(.secondary) }
            Section("History") { Text("No runs yet.").foregroundStyle(.secondary) }
        }
        .navigationTitle("Scheduled")
    }
}

private struct SettingsPlaceholder: View {
    var body: some View {
        List {
            Text("General").foregroundStyle(.secondary)
            Text("Providers").foregroundStyle(.secondary)
            Text("Permissions").foregroundStyle(.secondary)
            Text("Usage").foregroundStyle(.secondary)
        }
        .navigationTitle("Settings")
    }
}
