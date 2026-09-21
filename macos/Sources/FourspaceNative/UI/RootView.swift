import SwiftUI

/// Three-column shell: rail, space content, detail. The rail is the product's
/// home; columns resize natively.
struct RootView: View {
    @Environment(AppState.self) private var app
    @Environment(HarnessStore.self) private var harness
    @Environment(ChatViewModel.self) private var chat
    @Environment(ProjectsViewModel.self) private var projects

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
        .task {
            await harness.connect()
            guard harness.isConnected else { return }
            await chat.connect()
            await projects.refresh()
        }
    }

    private var selectionTitle: String {
        app.selection?.title ?? "Four Space"
    }
}
