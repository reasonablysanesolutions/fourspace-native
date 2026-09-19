import SwiftUI

/// Three-column shell: rail, space content, detail. The rail is the product's
/// home; columns resize natively.
struct RootView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        @Bindable var app = app
        NavigationSplitView {
            RailView(selection: $app.selection)
        } content: {
            SpaceContentList(selection: app.selection)
        } detail: {
            SpaceDetail(selection: app.selection)
        }
        .navigationTitle(selectionTitle)
    }

    private var selectionTitle: String {
        app.selection?.title ?? "Four Space"
    }
}
