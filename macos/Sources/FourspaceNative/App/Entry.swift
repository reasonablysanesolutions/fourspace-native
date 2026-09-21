import Foundation

/// Process entry point. Normally starts the SwiftUI app; with `--probe` it runs
/// a headless round-trip against a T3 server so the harness client can be
/// verified without driving the UI.
@main
enum Entry {
    static func main() async {
        if CommandLine.arguments.contains("--probe") {
            setvbuf(stdout, nil, _IOLBF, 0)
            DispatchQueue.global().asyncAfter(deadline: .now() + 90) {
                Probe.log("probe: watchdog fired")
                exit(2)
            }
            await Probe.run()
            exit(0)
        }
        FourspaceNativeApp.main()
    }
}
