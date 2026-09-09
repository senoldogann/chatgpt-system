import Foundation

public struct ComputerHealth: Codable, Equatable, Sendable {
    public let state: String
    public let accessibilityTrusted: Bool
    public let screenCaptureAuthorized: Bool

    public init(state: String, accessibilityTrusted: Bool, screenCaptureAuthorized: Bool) {
        self.state = state
        self.accessibilityTrusted = accessibilityTrusted
        self.screenCaptureAuthorized = screenCaptureAuthorized
    }
}

public struct ApplicationView: Codable, Equatable, Sendable {
    public let name: String
    public let bundleIdentifier: String?
    public let frontmost: Bool

    public init(name: String, bundleIdentifier: String?, frontmost: Bool) {
        self.name = name
        self.bundleIdentifier = bundleIdentifier
        self.frontmost = frontmost
    }
}

public struct ComputerBounds: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct ComputerElementView: Codable, Equatable, Sendable {
    public let index: Int
    public let role: String
    public let subrole: String?
    public let title: String?
    public let description: String?
    public let focused: Bool?
    public let enabled: Bool?
    public let selected: Bool?
    public let bounds: ComputerBounds?

    public init(
        index: Int,
        role: String,
        subrole: String?,
        title: String?,
        description: String?,
        focused: Bool?,
        enabled: Bool?,
        selected: Bool?,
        bounds: ComputerBounds?
    ) {
        self.index = index
        self.role = role
        self.subrole = subrole
        self.title = title
        self.description = description
        self.focused = focused
        self.enabled = enabled
        self.selected = selected
        self.bounds = bounds
    }
}

public struct ActiveWindowView: Codable, Equatable, Sendable {
    public let application: ApplicationView
    public let title: String?

    public init(application: ApplicationView, title: String?) {
        self.application = application
        self.title = title
    }
}

public struct ComputerObservation: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let application: ApplicationView
    public let windowTitle: String?
    public let elements: [ComputerElementView]
    public let truncated: Bool

    public init(
        snapshotId: String,
        application: ApplicationView,
        windowTitle: String?,
        elements: [ComputerElementView],
        truncated: Bool
    ) {
        self.snapshotId = snapshotId
        self.application = application
        self.windowTitle = windowTitle
        self.elements = elements
        self.truncated = truncated
    }
}

public struct ComputerScreenshot: Codable, Equatable, Sendable {
    public let pngBase64: String
    public let width: Int
    public let height: Int

    public init(pngBase64: String, width: Int, height: Int) {
        self.pngBase64 = pngBase64
        self.width = width
        self.height = height
    }
}
