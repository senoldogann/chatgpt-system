import ComputerRuntimeCore
import Foundation

enum InputEvent: Equatable, Sendable {
    case mouseMove(point: ComputerPoint, dragButton: ComputerMouseButton?)
    case mouseButton(button: ComputerMouseButton, down: Bool, point: ComputerPoint, clickCount: Int)
    case scroll(vertical: Int32, horizontal: Int32)
    case key(keyCode: UInt16, down: Bool, modifiers: Set<ComputerKeyModifier>)
    case unicode(String)
}

protocol InputEventSink: Sendable {
    func emit(_ event: InputEvent) throws
}

protocol PointerReading: Sendable {
    func currentPointerPosition() throws -> ComputerPoint
}

protocol DisplayTopologyReading: Sendable {
    func activeDisplayBounds() throws -> [ComputerBounds]
}

protocol InputSleeping: Sendable {
    func sleep(nanoseconds: UInt64) async throws
}

enum ComputerInputError: Error, Equatable, Sendable {
    case targetOutOfBounds
    case unavailable
}

struct HeldInputState: Equatable, Sendable {
    var mouseButtons: Set<ComputerMouseButton> = []
    var modifiers: Set<ComputerKeyModifier> = []
    var keyCodes: Set<UInt16> = []

    var isEmpty: Bool {
        mouseButtons.isEmpty && modifiers.isEmpty && keyCodes.isEmpty
    }
}

struct SystemInputSleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {
        guard nanoseconds > 0 else { return }
        try await Task.sleep(nanoseconds: nanoseconds)
    }
}
