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

protocol InputFocusGuard: Sendable {
    func verifyExpectedFrontmost() async throws
}

protocol ApplicationControlling: Sendable {
    func runningApplications() -> [WorkspaceApplication]
    func frontmostApplication() -> WorkspaceApplication?
    func applicationURL(bundleIdentifier: String) -> URL?
    func openApplication(at url: URL) async throws -> WorkspaceApplication
    func activate(_ application: WorkspaceApplication) -> Bool
}

enum ComputerInputError: Error, Equatable, Sendable {
    case targetOutOfBounds
    case invalidInput
    case focusMismatch
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

actor HeldInputStore {
    private var state = HeldInputState()

    func snapshot() -> HeldInputState { state }

    func insertMouseButton(_ button: ComputerMouseButton) {
        state.mouseButtons.insert(button)
    }

    func removeMouseButton(_ button: ComputerMouseButton) {
        state.mouseButtons.remove(button)
    }

    func insertModifier(_ modifier: ComputerKeyModifier) {
        state.modifiers.insert(modifier)
    }

    func removeModifier(_ modifier: ComputerKeyModifier) {
        state.modifiers.remove(modifier)
    }

    func insertKeyCode(_ keyCode: UInt16) {
        state.keyCodes.insert(keyCode)
    }

    func removeKeyCode(_ keyCode: UInt16) {
        state.keyCodes.remove(keyCode)
    }
}

struct SystemInputSleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {
        guard nanoseconds > 0 else { return }
        try await Task.sleep(nanoseconds: nanoseconds)
    }
}
