import Foundation

/// Browses a project's files and shows their contents. Reads through the
/// server's `projects.listEntries` / `projects.readFile` RPCs.
@MainActor
@Observable
final class FilesViewModel {
    struct Entry: Identifiable, Hashable, Sendable {
        let path: String
        let kind: String
        let ignored: Bool

        var id: String { path }
        var name: String { (path as NSString).lastPathComponent }
        var isDirectory: Bool { kind == "directory" }
    }

    private(set) var root: String?
    private(set) var children: [String: [Entry]] = [:]
    private(set) var expanded: Set<String> = []

    var selectedPath: String?
    var fileContents: String?
    var fileError: String?
    var errorText: String?
    var showIgnored = false

    private var harness: HarnessStore?

    func open(project: T3ProjectShell, harness: HarnessStore) async {
        self.harness = harness
        root = project.workspaceRoot
        children = [:]
        expanded = []
        selectedPath = nil
        fileContents = nil
        fileError = nil
        errorText = nil
        await load("")
    }

    func load(_ directory: String) async {
        guard let harness, let root else { return }
        do {
            let result = try await harness.rpc("projects.listEntries", .object([
                "cwd": .string(root),
                "directoryPath": .string(directory),
            ]))
            children[directory] = (result["entries"]?.arrayValue ?? []).compactMap { entry in
                guard let path = entry["path"]?.stringValue,
                      let kind = entry["kind"]?.stringValue else { return nil }
                return Entry(path: path, kind: kind, ignored: entry["ignored"]?.boolValue ?? false)
            }
            .sorted { lhs, rhs in
                if lhs.isDirectory != rhs.isDirectory { return lhs.isDirectory }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
        } catch {
            errorText = error.localizedDescription
        }
    }

    func toggle(_ entry: Entry) async {
        if expanded.contains(entry.path) {
            expanded.remove(entry.path)
        } else {
            expanded.insert(entry.path)
            if children[entry.path] == nil {
                await load(entry.path)
            }
        }
    }

    func openFile(_ path: String) async {
        guard let harness, let root else { return }
        selectedPath = path
        fileContents = nil
        fileError = nil
        do {
            fileContents = try await harness.readFile(cwd: root, relativePath: path) ?? ""
        } catch {
            fileError = error.localizedDescription
        }
    }

    func closeFile() {
        selectedPath = nil
        fileContents = nil
        fileError = nil
    }

    func reset() {
        root = nil
        children = [:]
        expanded = []
        selectedPath = nil
        fileContents = nil
        fileError = nil
        harness = nil
    }

    /// Flattened list of currently visible rows (respecting expansion and the
    /// ignored filter).
    var visibleRows: [Entry] {
        var rows: [Entry] = []
        func walk(_ directory: String) {
            for entry in children[directory] ?? [] {
                if entry.ignored && !showIgnored { continue }
                rows.append(entry)
                if entry.isDirectory, expanded.contains(entry.path) {
                    walk(entry.path)
                }
            }
        }
        walk("")
        return rows
    }
}
