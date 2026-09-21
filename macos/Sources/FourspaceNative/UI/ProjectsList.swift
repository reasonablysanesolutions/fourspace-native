import AppKit
import SwiftUI

/// Middle-column list of projects, with create and import actions.
struct ProjectsList: View {
    @Environment(ProjectsViewModel.self) private var projects
    @State private var showNewProject = false

    var body: some View {
        @Bindable var projects = projects
        VStack(spacing: 0) {
            HStack {
                Text("Projects")
                    .font(.headline)
                Spacer()
                Button(action: importFolder) {
                    Image(systemName: "folder.badge.plus")
                }
                .help("Import Existing Folder…")
                Button {
                    showNewProject = true
                } label: {
                    Image(systemName: "plus")
                }
                .help("New Project")
            }
            .buttonStyle(.borderless)
            .disabled(!projects.harness.isConnected)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            List(selection: selection) {
                if !projects.harness.isConnected {
                    Text("Connect to a T3 server to see projects.")
                        .foregroundStyle(.secondary)
                } else if projects.projects.isEmpty {
                    Text("No projects yet. Create one or import an existing folder.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(projects.projects, id: \.id) { project in
                        row(project)
                    }
                }
            }
        }
        .navigationTitle("Projects")
        .sheet(isPresented: $showNewProject) {
            NewProjectSheet()
        }
    }

    private func row(_ project: T3ProjectShell) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(project.title)
                .lineLimit(1)
            Text(project.workspaceRoot)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .tag(project.id)
    }

    private var selection: Binding<String?> {
        Binding(
            get: { projects.selectedProjectId },
            set: { if let id = $0 { projects.selectProject(id) } }
        )
    }

    private func importFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Import"
        panel.message = "Choose an existing folder to adopt as a project. It will not be moved or copied."
        if panel.runModal() == .OK, let url = panel.url {
            Task { await projects.importFolder(url) }
        }
    }
}

/// Sheet for creating a brand-new project folder.
struct NewProjectSheet: View {
    @Environment(ProjectsViewModel.self) private var projects
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var parent = NewProjectSheet.defaultParent()

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New Project")
                .font(.headline)

            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)

            HStack(spacing: 8) {
                Text(parent.path)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Choose…", action: chooseParent)
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create") {
                    Task {
                        await projects.createProject(title: name, parentDirectory: parent)
                        dismiss()
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 460)
    }

    private func chooseParent() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        if panel.runModal() == .OK, let url = panel.url {
            parent = url
        }
    }

    static func defaultParent() -> URL {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let projekt = home.appendingPathComponent("Projekt")
        return FileManager.default.fileExists(atPath: projekt.path) ? projekt : home
    }
}
