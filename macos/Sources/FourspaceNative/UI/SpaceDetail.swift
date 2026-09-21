import SwiftUI

/// Detail column. Empty for now; each space gets its real surface in later
/// phases.
struct SpaceDetail: View {
    let selection: RailSelection?

    var body: some View {
        switch selection {
        case .space(.chat):
            ChatView()
        case .space(let space):
            ContentUnavailableView {
                Label(space.title, systemImage: space.symbol)
                    .foregroundStyle(space.accent)
            } description: {
                Text("The work surface for \(space.title) lands in a later phase.")
            }
        case .global(let destination):
            ContentUnavailableView(
                destination.title,
                systemImage: destination.symbol,
                description: Text("Not implemented yet.")
            )
        case nil:
            ContentUnavailableView(
                "Four Space",
                systemImage: "square.grid.2x2",
                description: Text("Select a space to begin.")
            )
        }
    }
}
