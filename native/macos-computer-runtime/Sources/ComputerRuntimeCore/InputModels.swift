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

public struct ComputerActionResult: Codable, Equatable, Sendable {
    public let state: String
    public let pointer: ComputerPoint?
    public let changed: Bool?

    public init(state: String, pointer: ComputerPoint? = nil, changed: Bool? = nil) {
        self.state = state
        self.pointer = pointer
        self.changed = changed
    }
}
