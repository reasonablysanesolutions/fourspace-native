import Foundation

enum NotesFile {
    static let filename = "NOTES.md"
    /// Autosave waits this long after the last keystroke before writing.
    static let autosaveDelay: Duration = .milliseconds(1500)

    /// The read RPC reports operation failures; a missing file is the normal
    /// first-open case. Match the platform's missing-file messages.
    static func isMissingError(_ error: Error) -> Bool {
        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return message.range(
            of: "no such file|ENOENT|not found|does not exist",
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }
}

/// A pretty editor over `NOTES.md` in a workspace root. The file is the source
/// of truth: any editor or harness can read and write it, and it versions like
/// any other file. Notes are never attached to prompts automatically.
@MainActor
@Observable
final class NotesViewModel {
    enum Status: Equatable {
        case idle
        case loading
        case ready
        case edited
        case saving
        case missing
        case error(String)
    }

    var text: String = ""
    var status: Status = .idle

    private var cwd: String?
    private var lastSaved: String?
    private var harness: HarnessStore?
    private var saveTask: Task<Void, Never>?

    var isBlocked: Bool {
        if case .error = status { return true }
        return false
    }

    var statusLabel: String {
        switch status {
        case .idle: ""
        case .loading: "Loading…"
        case .ready: "Saved"
        case .edited: "Edited"
        case .saving: "Saving…"
        case .missing: "New file"
        case .error: "Couldn’t load"
        }
    }

    /// Reads once on open. A missing file starts empty (created on first save);
    /// any other read failure blocks editing so an unreadable file is never
    /// silently overwritten.
    func open(project: T3ProjectShell, harness: HarnessStore) async {
        saveTask?.cancel()
        saveTask = nil
        self.harness = harness
        cwd = project.workspaceRoot
        text = ""
        lastSaved = nil
        status = .loading
        do {
            if let contents = try await harness.readFile(
                cwd: project.workspaceRoot,
                relativePath: NotesFile.filename
            ) {
                text = contents
                lastSaved = contents
                status = .ready
            } else {
                status = .missing
            }
        } catch {
            status = .error(error.localizedDescription)
        }
    }

    func update(_ value: String) {
        guard !isBlocked else { return }
        text = value
        status = .edited
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: NotesFile.autosaveDelay)
            guard !Task.isCancelled else { return }
            await self?.save()
        }
    }

    func save() async {
        guard let harness, let cwd, text != lastSaved else { return }
        status = .saving
        do {
            try await harness.writeFile(cwd: cwd, relativePath: NotesFile.filename, contents: text)
            lastSaved = text
            status = .ready
        } catch {
            status = .error(error.localizedDescription)
        }
    }

    func reset() {
        saveTask?.cancel()
        saveTask = nil
        cwd = nil
        harness = nil
        lastSaved = nil
        text = ""
        status = .idle
    }
}
