// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "BeforeIDeploy",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "BeforeIDeploy",
            path: "Sources/BeforeIDeploy"
        )
    ]
)
