import ComputerRuntimeCore
import CoreGraphics
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

public struct ObservationLimits: Equatable, Sendable {
    public let maxElements: Int
    public let maxSerializedCharacters: Int
    public let maxDepth: Int

    public init(maxElements: Int, maxSerializedCharacters: Int, maxDepth: Int) {
        self.maxElements = maxElements
        self.maxSerializedCharacters = maxSerializedCharacters
        self.maxDepth = maxDepth
    }

    public static let `default` = ObservationLimits(
        maxElements: 500,
        maxSerializedCharacters: 262_144,
        maxDepth: 12
    )
}

public enum AccessibilityReadError: Error, Equatable, Sendable {
    case permissionRequired
    case unavailable
}

public enum ScreenshotCaptureError: Error, Equatable, Sendable {
    case unavailable
    case outputLimit
}

public protocol PermissionReading: Sendable {
    func accessibilityTrusted() -> Bool
    func screenCaptureAuthorized() -> Bool
    func eventListenAuthorized() -> Bool
    func eventPostAuthorized() -> Bool
}

public extension PermissionReading {
    func eventListenAuthorized() -> Bool { false }
    func eventPostAuthorized() -> Bool { false }
}

public protocol WorkspaceReading: Sendable {
    func runningApplications() -> [WorkspaceApplication]
    func frontmostApplication() -> WorkspaceApplication?
}

public protocol AccessibilityReading: Sendable {
    func activeWindow(for application: WorkspaceApplication) throws -> ActiveWindowView
    func observe(for application: WorkspaceApplication, limits: ObservationLimits) throws -> ComputerObservation
}

protocol ComputerObservationCaching: Sendable {
    func store(_ observation: CachedComputerObservation)
    func current(
        appIdentity: String,
        windowIdentity: String,
        windowGeneration: String,
        displayTopologyDigest: String
    ) -> CachedComputerObservation?
    func invalidate()
    func updateCapability(
        appIdentity: String,
        windowIdentity: String,
        windowGeneration: String,
        capability: PerceptionCapabilityProfile
    )
}

public protocol ScreenshotCapturing: Sendable {
    func captureMainDisplay(maxBytes: Int) async throws -> ComputerScreenshot
}

protocol ScreenImageCapturing: Sendable {
    func captureMainDisplayImage() async throws -> CGImage
}

protocol VisionTextRecognizing: Sendable {
    func recognizeText(in image: CGImage, mode: VisionRecognitionMode) async throws -> [OcrTextCandidate]
}

public protocol ComputerActionHandling: Sendable {
    func handleAction(_ request: ComputerProtocolRequest) async -> ComputerProtocolResponse?
    func shutdown() async
}

public extension ComputerActionHandling {
    func shutdown() async {}
}
