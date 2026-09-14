import Foundation

public struct ComputerHealth: Codable, Equatable, Sendable {
    public let state: String
    public let accessibilityTrusted: Bool
    public let screenCaptureAuthorized: Bool
    public let eventListenAuthorized: Bool
    public let eventPostAuthorized: Bool

    public init(
        state: String,
        accessibilityTrusted: Bool,
        screenCaptureAuthorized: Bool,
        eventListenAuthorized: Bool = false,
        eventPostAuthorized: Bool = false
    ) {
        self.state = state
        self.accessibilityTrusted = accessibilityTrusted
        self.screenCaptureAuthorized = screenCaptureAuthorized
        self.eventListenAuthorized = eventListenAuthorized
        self.eventPostAuthorized = eventPostAuthorized
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

public enum ComputerAXQuality: String, Codable, Equatable, Sendable {
    case strong
    case partial
    case weak
}

public enum ComputerRecommendedTargeting: String, Codable, Equatable, Sendable {
    case ax
    case ocr
    case visualPoint = "visual-point"
}

public enum ComputerOcrSource: String, Codable, Equatable, Sendable {
    case visionFast = "vision-fast"
    case visionAccurate = "vision-accurate"
}

public struct ComputerOcrCandidateView: Codable, Equatable, Sendable {
    public let text: String
    public let bounds: ComputerBounds
    public let confidence: Double?
    public let source: ComputerOcrSource

    public init(
        text: String,
        bounds: ComputerBounds,
        confidence: Double?,
        source: ComputerOcrSource
    ) {
        self.text = text
        self.bounds = bounds
        self.confidence = confidence
        self.source = source
    }

    private enum CodingKeys: String, CodingKey {
        case text
        case bounds
        case confidence
        case source
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(text, forKey: .text)
        try container.encode(bounds, forKey: .bounds)
        if let confidence {
            try container.encode(confidence, forKey: .confidence)
        } else {
            try container.encodeNil(forKey: .confidence)
        }
        try container.encode(source, forKey: .source)
    }
}

public struct ComputerPerceptionSummary: Codable, Equatable, Sendable {
    public let axQuality: ComputerAXQuality
    public let webContentAccessible: Bool?
    public let ocrUsed: Bool
    public let recommendedTargeting: ComputerRecommendedTargeting
    public let ocrCandidates: [ComputerOcrCandidateView]

    public init(
        axQuality: ComputerAXQuality,
        webContentAccessible: Bool?,
        ocrUsed: Bool,
        recommendedTargeting: ComputerRecommendedTargeting,
        ocrCandidates: [ComputerOcrCandidateView]
    ) {
        self.axQuality = axQuality
        self.webContentAccessible = webContentAccessible
        self.ocrUsed = ocrUsed
        self.recommendedTargeting = recommendedTargeting
        self.ocrCandidates = ocrCandidates
    }

    private enum CodingKeys: String, CodingKey {
        case axQuality
        case webContentAccessible
        case ocrUsed
        case recommendedTargeting
        case ocrCandidates
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(axQuality, forKey: .axQuality)
        if let webContentAccessible {
            try container.encode(webContentAccessible, forKey: .webContentAccessible)
        } else {
            try container.encodeNil(forKey: .webContentAccessible)
        }
        try container.encode(ocrUsed, forKey: .ocrUsed)
        try container.encode(recommendedTargeting, forKey: .recommendedTargeting)
        try container.encode(ocrCandidates, forKey: .ocrCandidates)
    }
}

public struct ComputerObservation: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let application: ApplicationView
    public let windowTitle: String?
    public let elements: [ComputerElementView]
    public let truncated: Bool
    public let digest: String?
    public let perception: ComputerPerceptionSummary?

    public init(
        snapshotId: String,
        application: ApplicationView,
        windowTitle: String?,
        elements: [ComputerElementView],
        truncated: Bool,
        digest: String? = nil,
        perception: ComputerPerceptionSummary? = nil
    ) {
        self.snapshotId = snapshotId
        self.application = application
        self.windowTitle = windowTitle
        self.elements = elements
        self.truncated = truncated
        self.digest = digest
        self.perception = perception
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
