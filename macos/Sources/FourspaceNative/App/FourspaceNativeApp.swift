import SwiftUI

@main
struct FourspaceNativeApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
        }
        .defaultSize(width: 1280, height: 820)
        .commands {
            SidebarCommands()

            CommandGroup(replacing: .newItem) {
                Button("New Chat") {}
                    .keyboardShortcut("n", modifiers: .command)
            }
        }
    }
}
