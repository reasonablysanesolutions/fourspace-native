import SwiftUI

/// Sheet over `NOTES.md` for the selected project, experiment or product.
struct NotesSheet: View {
    let project: T3ProjectShell

    @Environment(ProjectsViewModel.self) private var projects
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("Notes")
                    .font(.headline)
                Text(NotesFile.filename)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(projects.notes.statusLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(12)

            Divider()

            switch projects.notes.status {
            case .error(let message):
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2)
                        .foregroundStyle(.orange)
                    Text(message)
                        .font(.callout)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 420)
                    Button("Retry") {
                        Task {
                            await projects.notes.open(project: project, harness: projects.harness)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()

            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            default:
                TextEditor(text: Binding(
                    get: { projects.notes.text },
                    set: { projects.notes.update($0) }
                ))
                .font(.system(.body, design: .monospaced))
                .padding(8)
            }
        }
        .frame(width: 660, height: 500)
        .task {
            await projects.notes.open(project: project, harness: projects.harness)
        }
    }
}
