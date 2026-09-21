import AppKit
import SwiftUI

/// Middle-column list of projects for a kind space, with create/import and
/// classification.
struct ProjectsList: View {
    let space: FourSpace

    @Environment(ProjectsViewModel.self) private var projects
    @State private var showNewProject = false
    @State private var pendingRemoval: T3ProjectShell?

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

            if let error = projects.errorText {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            }

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
        .alert(
            "Remove Project?",
            isPresented: Binding(
                get: { pendingRemoval != nil },
                set: { if !$0 { pendingRemoval = nil } }
            )
        ) {
            Button("Remove", role: .destructive) {
                if let project = pendingRemoval {
                    Task { await projects.remove(project) }
                }
                pendingRemoval = nil
            }
            Button("Cancel", role: .cancel) { pendingRemoval = nil }
        } message: {
            Text("Removes the project from T3 and clears its classification. The folder on disk is not deleted.")
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
            Divider()
            Button("Move into Four Space") {
                Task { await projects.moveIntoStructure(project) }
            }
            Divider()
            Button("Remove Project…", role: .destructive) { pendingRemoval = project }
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
        panel.message = "Choose an existing folder. It is moved into your Four Space \(space.kind?.directoryName ?? "Projects") folder and adopted as a project."
        if panel.runModal() == .OK, let url = panel.url {
            Task { await projects.importFolder(url) }
        }
    }
}

/// Sheet for creating a brand-new project folder under the Four Space root.
struct NewProjectSheet: View {
    @Environment(ProjectsViewModel.self) private var projects
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New \(kind.title)")
                .font(.headline)

            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)

            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Destination")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(destination)
                        .font(.callout)
                        .lineLimit(2)
                        .truncationMode(.middle)
                }
                Spacer()
                Button("Change Root…", action: chooseRoot)
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create") {
                    Task {
                        await projects.createProject(name: name)
                        dismiss()
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!canCreate)
            }
        }
        .padding(20)
        .frame(width: 500)
    }

    private var kind: FourSpaceKind {
        projects.space.kind ?? .project
    }

    private var destination: String {
        projects.registry.resolveDestination(kind: kind, name: name)
            ?? "\(projects.registry.resolvedDefaultRoot)/\(kind.directoryName)/…"
    }

    private var canCreate: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func chooseRoot() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Use as Root"
        panel.message = "Choose the Four Space root. New workspaces go in its Experiments, Projects and Products folders."
        if panel.runModal() == .OK, let url = panel.url {
            projects.registry.defaultRoot = url.path
            projects.registry.save()
        }
    }
}
