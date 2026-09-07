// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "chatgpt-system-authority-broker",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(
            name: "chatgpt-system-authority-broker",
            targets: ["chatgpt-system-authority-broker"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "chatgpt-system-authority-broker"
        ),
    ]
)
