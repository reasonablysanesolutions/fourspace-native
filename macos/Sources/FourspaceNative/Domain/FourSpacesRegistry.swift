import Foundation
import SwiftUI

/// The three classified kinds. `chat` is deliberately not a kind: Chat has its
/// own hidden workspace and is never classified.
enum FourSpaceKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case experiment
    case project
    case product

    var id: String { rawValue }

    var title: String {
        switch self {
        case .experiment: "Experiment"
        case .project: "Project"
        case .product: "Product"
        }
    }

    var symbol: String {
        switch self {
        case .experiment: "flask"
        case .project: "folder"
        case .product: "shippingbox"
        }
    }

    var accent: Color {
        switch self {
        case .experiment: .purple
        case .project: .green
        case .product: .orange
        }
    }

    /// Standard subdirectory under the Four Space root, matching the Electron
    /// product's `KIND_DIRECTORY_NAMES`.
    var directoryName: String {
        switch self {
        case .experiment: "Experiments"
        case .project: "Projects"
        case .product: "Products"
        }
    }
}

enum FourSpaceImportMode: String, CaseIterable, Identifiable, Sendable {
    case keep
    case move
    case copy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .keep: "Keep in place"
        case .move: "Move into Four Space"
        case .copy: "Copy into Four Space"
        }
    }
}

/// The Electron product's default root. Kept for compatibility; the native
/// registry falls back here only when the configured root is unset.
let defaultFourSpaceRoot = "/Volumes/Mr_Jones/T3"

struct FourSpaceEntry: Codable, Hashable, Sendable {
    var projectId: String
    var workspaceRoot: String
    var kind: FourSpaceKind
    /// For an experiment or project created from a Product, the owning product.
    var originProductId: String?
}

/// Classifies T3 projects into Four Space kinds.
///
/// This is a side system: it never adds fields to T3's project model and never
/// touches the project folder. It is a small, documented, non-destructive JSON
/// file in Application Support that is trivial to ignore or delete.
@MainActor
@Observable
final class FourSpacesRegistry {
    private(set) var entries: [String: FourSpaceEntry] = [:]
    var defaultRoot: String
    /// The hidden backing project for the Chat space; never listed in a kind
    /// space.
    private(set) var chatProjectId: String?

    private let url: URL

    private struct RegistryFile: Codable {
        var version: Int
        var defaultRoot: String
        var chatProjectId: String?
        var entries: [FourSpaceEntry]
    }

    init(url: URL = FourSpacesRegistry.defaultURL()) {
        self.url = url
        defaultRoot = FourSpacesRegistry.defaultRootDefault()
        load()
    }

    /// The configured root, or a sensible default. Prefers the Electron
    /// product's root when it exists on disk, then `~/FourSpace`.
    var resolvedDefaultRoot: String {
        let trimmed = defaultRoot.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return trimmed }
        return FourSpacesRegistry.defaultRootDefault()
    }

    static func defaultRootDefault() -> String {
        defaultFourSpaceRoot
    }

    /// A safe single folder name, or nil when nothing usable remains. Mirrors
    /// the Electron `sanitizeFolderName`: separators become dashes so a pasted
    /// path cannot escape the destination directory.
    static func sanitizeFolderName(_ value: String) -> String? {
        var collapsed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        collapsed = collapsed.replacingOccurrences(
            of: "[/\\\\]+",
            with: "-",
            options: .regularExpression
        )
        collapsed = collapsed.replacingOccurrences(
            of: "\\s+",
            with: " ",
            options: .regularExpression
        )
        collapsed = collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
        if collapsed.isEmpty || collapsed == "." || collapsed == ".." { return nil }
        return String(collapsed.prefix(128))
    }

    /// Compares roots ignoring a trailing slash.
    static func normalizePath(_ path: String) -> String {
        path.replacingOccurrences(of: "[/\\\\]+$", with: "", options: .regularExpression)
    }

    /// `<resolvedRoot>/<KindDirectory>/<folder>`, matching the Electron
    /// `resolveImportDestination`.
    func resolveDestination(kind: FourSpaceKind, name: String) -> String? {
        guard let folder = Self.sanitizeFolderName(name) else { return nil }
        let root = resolvedDefaultRoot.replacingOccurrences(
            of: "[/\\\\]+$",
            with: "",
            options: .regularExpression
        )
        guard !root.isEmpty else { return nil }
        return "\(root)/\(kind.directoryName)/\(folder)"
    }

    // MARK: - Queries

    func kind(for projectId: String) -> FourSpaceKind? {
        entries[projectId]?.kind
    }

    /// A kind space shows projects classified as that kind **plus unclassified
    /// projects**, so organising never hides work. Product follows the same
    /// rule for consistency with the Electron product.
    func isVisible(projectId: String, in space: FourSpace) -> Bool {
        guard space != .chat else { return false }
        if projectId == chatProjectId { return false }
        guard let kind = kind(for: projectId) else { return true }
        switch space {
        case .experiment: return kind == .experiment
        case .project: return kind == .project
        case .product: return kind == .product
        case .chat: return false
        }
    }

    func linked(toProduct productId: String, among projects: [T3ProjectShell]) -> [T3ProjectShell] {
        projects.filter { entries[$0.id]?.originProductId == productId }
    }

    // MARK: - Mutation

    func setKind(_ kind: FourSpaceKind?, for project: T3ProjectShell, originProductId: String? = nil) {
        if let kind {
            entries[project.id] = FourSpaceEntry(
                projectId: project.id,
                workspaceRoot: project.workspaceRoot,
                kind: kind,
                originProductId: originProductId ?? entries[project.id]?.originProductId
            )
        } else {
            entries.removeValue(forKey: project.id)
        }
        save()
    }

    /// Links or unlinks a project to a product without changing its kind.
    func setOriginProduct(_ productId: String?, for project: T3ProjectShell) {
        guard var entry = entries[project.id] else { return }
        entry.originProductId = productId
        entries[project.id] = entry
        save()
    }

    func originProductId(for projectId: String) -> String? {
        entries[projectId]?.originProductId
    }

    func setChatProject(_ projectId: String) {
        guard chatProjectId != projectId else { return }
        chatProjectId = projectId
        save()
    }

    // MARK: - Persistence

    private func load() {
        guard let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(RegistryFile.self, from: data) else {
            return
        }
        defaultRoot = file.defaultRoot
        chatProjectId = file.chatProjectId
        entries = Dictionary(uniqueKeysWithValues: file.entries.map { ($0.projectId, $0) })

        // Migrate the app's earlier `~/FourSpace` default to the product root.
        let legacy = (NSHomeDirectory() as NSString).appendingPathComponent("FourSpace")
        if defaultRoot == legacy {
            defaultRoot = FourSpacesRegistry.defaultRootDefault()
            save()
        }
    }

    func save() {
        let file = RegistryFile(
            version: 1,
            defaultRoot: defaultRoot,
            chatProjectId: chatProjectId,
            entries: entries.values.sorted { $0.projectId < $1.projectId }
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(file) else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }

    static func defaultURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("FourSpace/registry.json")
    }
}
