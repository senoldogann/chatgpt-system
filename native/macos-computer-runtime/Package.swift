// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "chatgpt-system-computer-runtime",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ComputerRuntimeCore", targets: ["ComputerRuntimeCore"]),
        .library(name: "ComputerRuntimeHostCore", targets: ["ComputerRuntimeHostCore"]),
        .executable(name: "chatgpt-system-computer-runtime", targets: ["ComputerRuntimeHost"]),
        .executable(name: "chatgpt-system-computer-runtime-fixture", targets: ["ComputerRuntimeFixture"]),
    ],
    targets: [
        .target(name: "ComputerRuntimeCore"),
        .target(name: "ComputerRuntimeHostCore", dependencies: ["ComputerRuntimeCore"]),
        .executableTarget(name: "ComputerRuntimeHost", dependencies: ["ComputerRuntimeCore", "ComputerRuntimeHostCore"]),
        .executableTarget(name: "ComputerRuntimeFixture"),
        .testTarget(name: "ComputerRuntimeCoreTests", dependencies: ["ComputerRuntimeCore"]),
        .testTarget(name: "ComputerRuntimeHostCoreTests", dependencies: ["ComputerRuntimeCore", "ComputerRuntimeHostCore"]),
    ]
)
