import SwiftUI

/// Middle column: scheduled jobs, enabled first.
struct ScheduledList: View {
    @Environment(ScheduledViewModel.self) private var scheduled
    @State private var showNew = false

    var body: some View {
        @Bindable var scheduled = scheduled
        VStack(spacing: 0) {
            HStack {
                Text("Scheduled")
                    .font(.headline)
                Spacer()
                Button {
                    showNew = true
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.borderless)
                .disabled(!scheduled.harness.isConnected)
                .help("New Scheduled Job")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            if let error = scheduled.errorText {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            }

            List(selection: selection) {
                if !scheduled.harness.isConnected {
                    Text("Connect to a T3 server to see scheduled jobs.")
                        .foregroundStyle(.secondary)
                } else if scheduled.jobs.isEmpty {
                    Text("No scheduled jobs yet.")
                        .foregroundStyle(.secondary)
                } else {
                    if !scheduled.upcoming.isEmpty {
                        Section("Upcoming") {
                            ForEach(scheduled.upcoming, id: \.id) { row($0) }
                        }
                    }
                    if !scheduled.paused.isEmpty {
                        Section("Paused") {
                            ForEach(scheduled.paused, id: \.id) { row($0) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Scheduled")
        .sheet(isPresented: $showNew) {
            ScheduledJobSheet(job: nil)
        }
        .task {
            await scheduled.refresh()
        }
    }

    private func row(_ job: ScheduledJob) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(job.title)
                .lineLimit(1)
            Text("\(job.schedule.summary) · \(scheduled.projectTitle(job.projectId))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .tag(job.id)
    }

    private var selection: Binding<String?> {
        Binding(
            get: { scheduled.selectedJobId },
            set: { scheduled.selectedJobId = $0 }
        )
    }
}
