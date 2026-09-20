import Foundation

public struct ComputerPoint: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public enum PointerMotionMode: String, Codable, Equatable, Sendable {
    case instant
    case fast
    case natural
}

public enum ComputerMouseButton: String, Codable, Equatable, Hashable, CaseIterable, Sendable {
    case left
    case right
    case middle
}

public enum ComputerKeyModifier: String, Codable, Equatable, Hashable, CaseIterable, Sendable {
    case control
    case option
    case shift
    case command
}

public struct ComputerApplicationSelector: Codable, Equatable, Sendable {
    public let bundleIdentifier: String?
    public let name: String?

    public init(bundleIdentifier: String?, name: String?) {
        self.bundleIdentifier = bundleIdentifier
        self.name = name
    }
}

public enum ComputerVerificationKind: String, Codable, Equatable, Sendable {
    case ax
    case text
    case screenRegion = "screen-region"
    case none
}

public struct ComputerVerificationEvidence: Codable, Equatable, Sendable {
    public let kind: ComputerVerificationKind
    public let changed: Bool?

    private enum CodingKeys: String, CodingKey {
        case kind
        case changed
    }

    public init(kind: ComputerVerificationKind, changed: Bool?) {
        self.kind = kind
        self.changed = changed
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        if let changed {
            try container.encode(changed, forKey: .changed)
        } else {
            try container.encodeNil(forKey: .changed)
        }
    }
}

public struct ComputerActionResult: Codable, Equatable, Sendable {
    public let state: String
    public let pointer: ComputerPoint?
    public let changed: Bool?
    public let verification: ComputerVerificationEvidence?

    public init(
        state: String,
        pointer: ComputerPoint? = nil,
        changed: Bool? = nil,
        verification: ComputerVerificationEvidence? = nil
    ) {
        self.state = state
        self.pointer = pointer
        self.changed = changed
        self.verification = verification
    }
}
