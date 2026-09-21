import SwiftUI

struct FourspaceNativeApp: App {
    @State private var appState = AppState()
    @State private var chat = ChatViewModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(chat)
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
