import SwiftUI

/// Right-hand file browser and viewer for the selected project.
struct FilesPanel: View {
    let project: T3ProjectShell

    @Environment(ProjectsViewModel.self) private var projects

    private var files: FilesViewModel { projects.files }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if let path = files.selectedPath {
                viewer(path: path)
            } else {
                tree
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            if let path = files.selectedPath {
                Button {
                    files.closeFile()
                } label: {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.borderless)
                Text(path)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.head)
            } else {
                Text("Files")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Toggle("Ignored", isOn: Bindable(files).showIgnored)
                    .toggleStyle(.checkbox)
                    .controlSize(.mini)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var tree: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
                ForEach(files.visibleRows) { entry in
                    row(entry)
                }
            }
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func row(_ entry: FilesViewModel.Entry) -> some View {
        let depth = entry.path.split(separator: "/").count - 1
        return Button {
            if entry.isDirectory {
                Task { await files.toggle(entry) }
            } else {
                Task { await files.openFile(entry.path) }
            }
        } label: {
            HStack(spacing: 6) {
                if entry.isDirectory {
                    Image(systemName: files.expanded.contains(entry.path) ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(width: 10)
                    Image(systemName: "folder")
                        .foregroundStyle(.secondary)
                } else {
                    Spacer().frame(width: 10)
                    Image(systemName: "doc.text")
                        .foregroundStyle(.secondary)
                }
                Text(entry.name)
                    .lineLimit(1)
                    .foregroundStyle(entry.ignored ? .secondary : .primary)
                Spacer()
            }
            .padding(.leading, CGFloat(depth) * 12 + 8)
            .padding(.trailing, 8)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func viewer(path: String) -> some View {
        if let error = files.fileError {
            Text(error)
                .font(.callout)
                .foregroundStyle(.red)
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else if let contents = files.fileContents {
            ScrollView([.horizontal, .vertical]) {
                Text(contents)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
