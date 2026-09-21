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
                SpaceThreadPlaceholder(space: space)
            case .global(.scheduled):
                ScheduledPlaceholder()
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

private struct SpaceThreadPlaceholder: View {
    let space: FourSpace

    var body: some View {
        List {
            Section {
                Text("No \(space.title.lowercased()) activity yet.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(space.title)
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
