import ComputerRuntimeCore
import Darwin

public struct WorkspaceApplication: Equatable, Sendable {
    public let processIdentifier: pid_t
    public let name: String
    public let bundleIdentifier: String?
    public let frontmost: Bool

    public init(
        processIdentifier: pid_t,
        name: String,
        bundleIdentifier: String?,
        frontmost: Bool
    ) {
        self.processIdentifier = processIdentifier
        self.name = name
        self.bundleIdentifier = bundleIdentifier
        self.frontmost = frontmost
    }

    public var view: ApplicationView {
        .init(name: name, bundleIdentifier: bundleIdentifier, frontmost: frontmost)
    }
}

public protocol PermissionReading: Sendable {
    func accessibilityTrusted() -> Bool
    func screenCaptureAuthorized() -> Bool
}

public protocol WorkspaceReading: Sendable {
    func runningApplications() -> [WorkspaceApplication]
    func frontmostApplication() -> WorkspaceApplication?
}
