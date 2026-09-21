import SwiftUI

/// Detail column: one scheduled job's configuration, actions and run history.
struct ScheduledDetail: View {
    @Environment(ScheduledViewModel.self) private var scheduled
    @State private var showEdit = false
    @State private var confirmDelete = false

    var body: some View {
        Group {
            if let job = scheduled.selectedJob {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header(job)
                        details(job)
                        actions(job)
                        runHistory(job)
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .sheet(isPresented: $showEdit) {
                    ScheduledJobSheet(job: job)
                }
                .alert("Delete this job?", isPresented: $confirmDelete) {
                    Button("Delete", role: .destructive) {
                        Task { await scheduled.delete(job) }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("The job and its schedule are removed. Existing runs and threads stay.")
                }
            } else {
                ContentUnavailableView(
                    "No job selected",
                    systemImage: "clock",
                    description: Text("Select a job or create a new one.")
                )
            }
        }
    }

    private func header(_ job: ScheduledJob) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(job.title)
                    .font(.title3.weight(.semibold))
                Text("\(job.schedule.summary) · \(scheduled.projectTitle(job.projectId))")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Toggle("Enabled", isOn: Binding(
                get: { job.enabled },
                set: { value in Task { await scheduled.setEnabled(job, value) } }
            ))
            .toggleStyle(.switch)
            .labelsHidden()
        }
    }

    private func details(_ job: ScheduledJob) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            labeled("Prompt", job.prompt)
            if let next = job.nextRunAt {
                labeled("Next run", ScheduledSchedule.shortDate(next))
            }
            if let last = job.lastRunAt {
                labeled("Last run", ScheduledSchedule.shortDate(last))
            }
        }
    }

    private func actions(_ job: ScheduledJob) -> some View {
        HStack(spacing: 10) {
            Button {
                Task { await scheduled.runNow(job) }
            } label: {
                Label("Run now", systemImage: "play")
            }
            Button {
                showEdit = true
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            Spacer()
            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    @ViewBuilder
    private func runHistory(_ job: ScheduledJob) -> some View {
        let history = scheduled.runs(for: job)
        VStack(alignment: .leading, spacing: 8) {
            Text("History")
                .font(.headline)
            if history.isEmpty {
                Text("No runs yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(history) { run in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(statusColor(run.status))
                            .frame(width: 8, height: 8)
                        Text(run.status.capitalized)
                        Spacer()
                        Text(ScheduledSchedule.shortDate(run.startedAt))
                            .foregroundStyle(.secondary)
                    }
                    .font(.callout)
                }
            }
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "running": .orange
        case "failed": .red
        default: .green
        }
    }

    private func labeled(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value.isEmpty ? "—" : value)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
