import Foundation

public enum ComputerTarget: Equatable, Sendable {
    case index(snapshotId: String, index: Int)
    case role(role: String, name: String?, exact: Bool)
    case text(text: String, exact: Bool)
    case label(label: String, exact: Bool)
    case ocrText(text: String, exact: Bool)
    case point(x: Double, y: Double)
}

extension ComputerTarget: Codable {
    private enum CodingKeys: String, CodingKey {
        case by
        case snapshotId
        case index
        case role
        case name
        case exact
        case text
        case label
        case x
        case y
    }

    private enum Kind: String, Codable {
        case index
        case role
        case text
        case label
        case ocrText
        case point
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .by)
        switch kind {
        case .index:
            self = .index(
                snapshotId: try container.decode(String.self, forKey: .snapshotId),
                index: try container.decode(Int.self, forKey: .index)
            )
        case .role:
            self = .role(
                role: try container.decode(String.self, forKey: .role),
                name: try container.decodeIfPresent(String.self, forKey: .name),
                exact: try container.decodeIfPresent(Bool.self, forKey: .exact) ?? false
            )
        case .text:
            self = .text(
                text: try container.decode(String.self, forKey: .text),
                exact: try container.decodeIfPresent(Bool.self, forKey: .exact) ?? false
            )
        case .label:
            self = .label(
                label: try container.decode(String.self, forKey: .label),
                exact: try container.decodeIfPresent(Bool.self, forKey: .exact) ?? false
            )
        case .ocrText:
            self = .ocrText(
                text: try container.decode(String.self, forKey: .text),
                exact: try container.decodeIfPresent(Bool.self, forKey: .exact) ?? false
            )
        case .point:
            self = .point(
                x: try container.decode(Double.self, forKey: .x),
                y: try container.decode(Double.self, forKey: .y)
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .index(snapshotId, index):
            try container.encode(Kind.index, forKey: .by)
            try container.encode(snapshotId, forKey: .snapshotId)
            try container.encode(index, forKey: .index)
        case let .role(role, name, exact):
            try container.encode(Kind.role, forKey: .by)
            try container.encode(role, forKey: .role)
            try container.encodeIfPresent(name, forKey: .name)
            try container.encode(exact, forKey: .exact)
        case let .text(text, exact):
            try container.encode(Kind.text, forKey: .by)
            try container.encode(text, forKey: .text)
            try container.encode(exact, forKey: .exact)
        case let .label(label, exact):
            try container.encode(Kind.label, forKey: .by)
            try container.encode(label, forKey: .label)
            try container.encode(exact, forKey: .exact)
        case let .ocrText(text, exact):
            try container.encode(Kind.ocrText, forKey: .by)
            try container.encode(text, forKey: .text)
            try container.encode(exact, forKey: .exact)
        case let .point(x, y):
            try container.encode(Kind.point, forKey: .by)
            try container.encode(x, forKey: .x)
            try container.encode(y, forKey: .y)
        }
    }
}

public enum ComputerTargetSource: String, Codable, Equatable, Sendable {
    case ax
    case ocr
    case point
}

public enum ComputerTargetConfidence: String, Codable, Equatable, Sendable {
    case deterministic
    case high
    case explicit
}

public enum AXQuality: String, Codable, Equatable, Sendable {
    case unknown
    case strong
    case partial
    case weak
}

public enum OCRUsefulness: String, Codable, Equatable, Sendable {
    case unknown
    case yes
    case no
}

public enum VisionRecognitionMode: String, Codable, Equatable, Sendable {
    case fast
    case accurate
}

public struct OcrTextCandidate: Codable, Equatable, Sendable {
    public let text: String
    public let bounds: ComputerBounds
    public let confidence: Float?
    public let source: VisionRecognitionMode
    public let observationId: String

    public init(
        text: String,
        bounds: ComputerBounds,
        confidence: Float?,
        source: VisionRecognitionMode,
        observationId: String
    ) {
        self.text = text
        self.bounds = bounds
        self.confidence = confidence
        self.source = source
        self.observationId = observationId
    }
}

public struct PerceptionCapabilityProfile: Codable, Equatable, Sendable {
    public let axQuality: AXQuality
    public let ocrUseful: OCRUsefulness
    public let lastObservationMonotonicMs: Double
    public let windowGeneration: String

    public init(
        axQuality: AXQuality,
        ocrUseful: OCRUsefulness,
        lastObservationMonotonicMs: Double,
        windowGeneration: String
    ) {
        self.axQuality = axQuality
        self.ocrUseful = ocrUseful
        self.lastObservationMonotonicMs = lastObservationMonotonicMs
        self.windowGeneration = windowGeneration
    }
}

public struct ResolvedComputerTarget: Equatable, Sendable {
    public let source: ComputerTargetSource
    public let bounds: ComputerBounds
    public let actionPoint: ComputerPoint
    public let observationId: String?
    public let appIdentity: String
    public let windowIdentity: String
    public let windowGeneration: String
    public let displayTopologyDigest: String
    public let confidence: ComputerTargetConfidence
    public let semanticFingerprint: String?

    public init(
        source: ComputerTargetSource,
        bounds: ComputerBounds,
        actionPoint: ComputerPoint,
        observationId: String?,
        appIdentity: String,
        windowIdentity: String,
        windowGeneration: String,
        displayTopologyDigest: String,
        confidence: ComputerTargetConfidence,
        semanticFingerprint: String?
    ) {
        self.source = source
        self.bounds = bounds
        self.actionPoint = actionPoint
        self.observationId = observationId
        self.appIdentity = appIdentity
        self.windowIdentity = windowIdentity
        self.windowGeneration = windowGeneration
        self.displayTopologyDigest = displayTopologyDigest
        self.confidence = confidence
        self.semanticFingerprint = semanticFingerprint
    }
}

public struct ComputerResolvedTargetView: Codable, Equatable, Sendable {
    public let source: ComputerTargetSource
    public let bounds: ComputerBounds
    public let actionPoint: ComputerPoint
    public let observationId: String?
    public let confidence: ComputerTargetConfidence

    public init(
        source: ComputerTargetSource,
        bounds: ComputerBounds,
        actionPoint: ComputerPoint,
        observationId: String?,
        confidence: ComputerTargetConfidence
    ) {
        self.source = source
        self.bounds = bounds
        self.actionPoint = actionPoint
        self.observationId = observationId
        self.confidence = confidence
    }
}

public struct CachedComputerObservation: Equatable, Sendable {
    public let observationId: String
    public let createdMonotonicMs: Double
    public let appIdentity: String
    public let windowIdentity: String
    public let windowGeneration: String
    public let displayTopologyDigest: String
    public let observation: ComputerObservation
    public let capability: PerceptionCapabilityProfile

    public init(
        observationId: String,
        createdMonotonicMs: Double,
        appIdentity: String,
        windowIdentity: String,
        windowGeneration: String,
        displayTopologyDigest: String,
        observation: ComputerObservation,
        capability: PerceptionCapabilityProfile
    ) {
        self.observationId = observationId
        self.createdMonotonicMs = createdMonotonicMs
        self.appIdentity = appIdentity
        self.windowIdentity = windowIdentity
        self.windowGeneration = windowGeneration
        self.displayTopologyDigest = displayTopologyDigest
        self.observation = observation
        self.capability = capability
    }

    public func replacingCapability(_ capability: PerceptionCapabilityProfile) -> CachedComputerObservation {
        CachedComputerObservation(
            observationId: observationId,
            createdMonotonicMs: createdMonotonicMs,
            appIdentity: appIdentity,
            windowIdentity: windowIdentity,
            windowGeneration: windowGeneration,
            displayTopologyDigest: displayTopologyDigest,
            observation: observation,
            capability: capability
        )
    }
}
