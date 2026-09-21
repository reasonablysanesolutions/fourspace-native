import SwiftUI

/// Right-hand Notes panel, shown beside the conversation for the selected
/// project, experiment or product.
struct NotesPanel: View {
    let project: T3ProjectShell

    @Environment(ProjectsViewModel.self) private var projects

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("Notes")
                    .font(.subheadline.weight(.semibold))
                Text(NotesFile.filename)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(projects.notes.statusLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

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
                    Button("Retry") {
                        Task {
                            await projects.notes.open(project: project, harness: projects.harness)
                        }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)

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
    }
}
