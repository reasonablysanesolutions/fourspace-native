import SwiftUI

struct FourspaceNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appState = AppState()
    @State private var harness: HarnessStore
    @State private var registry: FourSpacesRegistry
    @State private var chat: ChatViewModel
    @State private var projects: ProjectsViewModel

    init() {
        let harness = HarnessStore()
        let registry = FourSpacesRegistry()
        _harness = State(initialValue: harness)
        _registry = State(initialValue: registry)
        _chat = State(initialValue: ChatViewModel(harness: harness, registry: registry))
        _projects = State(initialValue: ProjectsViewModel(harness: harness, registry: registry))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(harness)
                .environment(registry)
                .environment(chat)
                .environment(projects)
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
