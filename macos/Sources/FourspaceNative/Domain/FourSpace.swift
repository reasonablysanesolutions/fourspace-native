import SwiftUI

/// The four core spaces plus the two global destinations.
///
/// Spaces are a UI/organisational dimension only. They never change how a
/// project is stored on disk; a Project is always just a folder.
enum FourSpace: String, CaseIterable, Identifiable, Hashable {
    case chat
    case experiment
    case project
    case product

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chat: "Chat"
        case .experiment: "Experiment"
        case .project: "Project"
        case .product: "Product"
        }
    }

    var symbol: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right"
        case .experiment: "flask"
        case .project: "folder"
        case .product: "shippingbox"
        }
    }

    /// Discrete identity accents. Colour aids orientation, it does not fill
    /// the screen.
    var accent: Color {
        switch self {
        case .chat: .blue        // royal blue
        case .experiment: .purple // velvet violet
        case .project: .green     // velvet green
        case .product: .orange    // warm accent
        }
    }

    /// The classification kind this space represents. Chat has none.
    var kind: FourSpaceKind? {
        switch self {
        case .chat: nil
        case .experiment: .experiment
        case .project: .project
        case .product: .product
        }
    }
}

/// Global destinations that live below the four spaces in the rail.
enum GlobalDestination: String, CaseIterable, Identifiable, Hashable {
    case scheduled
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .scheduled: "Scheduled"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .scheduled: "clock"
        case .settings: "gearshape"
        }
    }
}

/// What the rail can have selected.
enum RailSelection: Hashable {
    case space(FourSpace)
    case global(GlobalDestination)

    var title: String {
        switch self {
        case .space(let space): space.title
        case .global(let destination): destination.title
        }
    }
}
