// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "BeforeIDeploy",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "BeforeIDeploy",
            path: "Sources/BeforeIDeploy"
        ),
        // `swift test` (Command Line Tools are enough). Fixtures are real engine results captured by
        // `BID_WRITE_FIXTURES=1 node tests/run.mjs`, so the Swift models are checked against the same
        // JSON the engine tests assert on.
        .testTarget(
            name: "BeforeIDeployTests",
            dependencies: ["BeforeIDeploy"],
            path: "Tests/BeforeIDeployTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
