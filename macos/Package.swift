// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FourspaceNative",
    platforms: [
        .macOS(.v15)
    ],
    targets: [
        .executableTarget(
            name: "FourspaceNative",
            path: "Sources/FourspaceNative"
        )
    ]
)
