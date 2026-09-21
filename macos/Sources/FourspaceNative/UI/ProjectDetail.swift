import SwiftUI

/// Detail column for the Projects space: the selected project's threads and
/// the conversation for the active thread.
struct ProjectDetail: View {
    @Environment(ProjectsViewModel.self) private var projects

    var body: some View {
        @Bindable var projects = projects
        Group {
            if let project = projects.selectedProject {
                VStack(spacing: 0) {
                    header(project)
                    Divider()
                    HStack(spacing: 0) {
                        threadColumn
                            .frame(width: 240)
                        Divider()
                        conversationColumn
                    }
                }
            } else {
                ContentUnavailableView(
                    "No project selected",
                    systemImage: "folder",
                    description: Text("Select a project, or create or import one.")
                )
            }
        }
    }

    private func header(_ project: T3ProjectShell) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "folder")
                .foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 1) {
                Text(project.title)
                    .font(.headline)
                Text(project.workspaceRoot)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            ModelPicker()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var threadColumn: some View {
        @Bindable var projects = projects
        return VStack(spacing: 0) {
            HStack {
                Text("Threads")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button {
                    Task { await projects.newThread() }
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.borderless)
                .help("New Thread")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            List(selection: threadSelection) {
                if projects.projectThreads.isEmpty {
                    Text("No threads yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(projects.projectThreads, id: \.id) { thread in
                        Text(thread.title)
                            .lineLimit(1)
                            .tag(thread.id)
                    }
                }
            }
        }
    }

    private var threadSelection: Binding<String?> {
        Binding(
            get: { projects.activeThreadId },
            set: { if let id = $0 { projects.selectThread(id) } }
        )
    }

    private var conversationColumn: some View {
        @Bindable var projects = projects
        return Group {
            if projects.activeThreadId != nil {
                VStack(spacing: 0) {
                    MessageList(messages: projects.messages)
                    Divider()
                    Composer(text: $projects.draft, canSend: projects.canSend, errorText: projects.errorText) {
                        Task { await projects.send() }
                    }
                }
            } else {
                ContentUnavailableView(
                    "No thread selected",
                    systemImage: "bubble.left",
                    description: Text("Select a thread or create a new one.")
                )
            }
        }
    }
}
