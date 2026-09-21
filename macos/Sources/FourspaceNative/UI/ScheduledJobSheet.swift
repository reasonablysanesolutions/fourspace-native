import SwiftUI

/// Create or edit a scheduled job.
struct ScheduledJobSheet: View {
    let job: ScheduledJob?

    @Environment(ScheduledViewModel.self) private var scheduled
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var projectId = ""
    @State private var prompt = ""
    @State private var schedule = ScheduledSchedule(kind: .daily)
    @State private var onceDate = Date().addingTimeInterval(3600)
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(job == nil ? "New Scheduled Job" : "Edit Scheduled Job")
                .font(.headline)

            TextField("Title", text: $title)
                .textFieldStyle(.roundedBorder)

            Picker("Project", selection: $projectId) {
                ForEach(scheduled.projects, id: \.id) { project in
                    Text(project.title).tag(project.id)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Prompt")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextEditor(text: $prompt)
                    .font(.system(.body, design: .monospaced))
                    .frame(height: 120)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            }

            Picker("Schedule", selection: $schedule.kind) {
                ForEach(ScheduledFrequency.allCases) { frequency in
                    Text(frequency.title).tag(frequency)
                }
            }
            .pickerStyle(.segmented)

            scheduleFields

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save", action: save)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSave)
            }
        }
        .padding(20)
        .frame(width: 540)
        .task {
            guard !loaded else { return }
            loaded = true
            if let job {
                title = job.title
                projectId = job.projectId
                prompt = job.prompt
                schedule = job.schedule
            } else {
                projectId = scheduled.projects.first?.id ?? ""
            }
        }
    }

    @ViewBuilder
    private var scheduleFields: some View {
        switch schedule.kind {
        case .once:
            DatePicker("At", selection: $onceDate)
        case .daily:
            timeFields
        case .weekly:
            HStack {
                Picker("Day", selection: Binding(
                    get: { schedule.weekday ?? 1 },
                    set: { schedule.weekday = $0 }
                )) {
                    ForEach(0..<7, id: \.self) { index in
                        Text(ScheduledSchedule.weekdayName(index)).tag(index)
                    }
                }
                .frame(width: 140)
                timeFields
            }
        case .interval:
            HStack {
                Text("Every")
                TextField("Minutes", value: $schedule.intervalMinutes, format: .number)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 80)
                Text("minutes")
            }
        }
    }

    private var timeFields: some View {
        HStack {
            Text("Time")
            TextField("Hour", value: $schedule.hour, format: .number)
                .textFieldStyle(.roundedBorder)
                .frame(width: 60)
            Text(":")
            TextField("Minute", value: $schedule.minute, format: .number)
                .textFieldStyle(.roundedBorder)
                .frame(width: 60)
        }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !projectId.isEmpty
            && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func save() {
        var resolved = schedule
        if resolved.kind == .once {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            resolved.atIso = formatter.string(from: onceDate)
        }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            if let job {
                await scheduled.update(
                    job,
                    title: trimmedTitle,
                    projectId: projectId,
                    prompt: trimmedPrompt,
                    schedule: resolved
                )
            } else {
                await scheduled.create(
                    title: trimmedTitle,
                    projectId: projectId,
                    prompt: trimmedPrompt,
                    schedule: resolved
                )
            }
            dismiss()
        }
    }
}
