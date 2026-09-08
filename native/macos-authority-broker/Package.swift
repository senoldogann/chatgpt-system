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
        .executable(
            name: "chatgpt-system-keychain-helper",
            targets: ["chatgpt-system-keychain-helper"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "chatgpt-system-authority-broker"
        ),
        .executableTarget(
            name: "chatgpt-system-keychain-helper"
        ),
    ]
)
