import AppKit

/// App lifecycle hooks. Closing the last window quits the app, and quitting
/// stops the T3 server the app started.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        ServerController.terminateCurrent()
    }
}
