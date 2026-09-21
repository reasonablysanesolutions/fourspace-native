import AppKit
import SwiftUI

/// Middle-column list of projects for a kind space, with create/import and
/// classification.
struct ProjectsList: View {
    let space: FourSpace

    @Environment(ProjectsViewModel.self) private var projects
    @State private var showNewProject = false

    var body: some View {
        @Bindable var projects = projects
        VStack(spacing: 0) {
            HStack {
                Text(title)
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
                .help(newLabel)
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
                } else if visible.isEmpty {
                    Text(emptyText)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(visible, id: \.id) { project in
                        row(project)
                    }
                }
            }
        }
        .navigationTitle(title)
        .sheet(isPresented: $showNewProject) {
            NewProjectSheet()
        }
        .task(id: space) {
            projects.setSpace(space)
        }
    }

    private var visible: [T3ProjectShell] {
        projects.projects.filter { projects.registry.isVisible(projectId: $0.id, in: space) }
    }

    private var title: String {
        switch space {
        case .experiment: "Experiments"
        case .project: "Projects"
        case .product: "Products"
        case .chat: "Chat"
        }
    }

    private var newLabel: String {
        switch space {
        case .experiment: "New Experiment"
        case .product: "New Product"
        default: "New Project"
        }
    }

    private var emptyText: String {
        switch space {
        case .experiment: "No experiments yet. Create one or import an existing folder."
        case .product: "No products yet. Create one or import an existing folder."
        default: "No projects yet. Create one or import an existing folder."
        }
    }

    private func row(_ project: T3ProjectShell) -> some View {
        HStack(spacing: 8) {
            Image(systemName: kindSymbol(project))
                .foregroundStyle(kindColor(project))
            VStack(alignment: .leading, spacing: 2) {
                Text(project.title)
                    .lineLimit(1)
                Text(project.workspaceRoot)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .tag(project.id)
        .contextMenu {
            ForEach(FourSpaceKind.allCases) { kind in
                Button(kind.title) { projects.classify(kind, project: project) }
            }
            Divider()
            Button("Unclassified") { projects.classify(nil, project: project) }

            let linkable = projects.products.filter { $0.id != project.id }
            if !linkable.isEmpty {
                Divider()
                Menu("Link to Product") {
                    ForEach(linkable, id: \.id) { product in
                        Button(product.title) { projects.link(project, toProduct: product) }
                    }
                }
            }
            if projects.originProduct(for: project) != nil {
                Button("Unlink from Product") { projects.unlink(project) }
            }
        }
    }

    private func kindSymbol(_ project: T3ProjectShell) -> String {
        projects.kind(for: project)?.symbol ?? "circle.dashed"
    }

    private func kindColor(_ project: T3ProjectShell) -> Color {
        projects.kind(for: project)?.accent ?? .secondary
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
            Text("New \(projects.space.kind?.title ?? "Project")")
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
