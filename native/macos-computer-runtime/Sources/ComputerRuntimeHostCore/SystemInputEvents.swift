import ComputerRuntimeCore
import CoreGraphics
import Foundation

enum RuntimeOwnedEventTag {
    static let value: Int64 = 0x4352_5632_494E_5054
}

struct SystemInputEventSink: InputEventSink {
    func emit(_ event: InputEvent) throws {
        guard CGPreflightPostEventAccess(),
              let source = CGEventSource(stateID: .privateState)
        else {
            throw ComputerInputError.unavailable
        }

        let cgEvent: CGEvent
        switch event {
        case let .mouseMove(point, dragButton):
            let type: CGEventType
            let button: CGMouseButton
            switch dragButton {
            case .left:
                type = .leftMouseDragged
                button = .left
            case .right:
                type = .rightMouseDragged
                button = .right
            case .middle:
                type = .otherMouseDragged
                button = .center
            case nil:
                type = .mouseMoved
                button = .left
            }
            guard let created = CGEvent(
                mouseEventSource: source,
                mouseType: type,
                mouseCursorPosition: CGPoint(x: point.x, y: point.y),
                mouseButton: button
            ) else {
                throw ComputerInputError.unavailable
            }
            cgEvent = created

        case .mouseButton, .scroll, .key, .unicode:
            throw ComputerInputError.unavailable
        }

        cgEvent.setIntegerValueField(.eventSourceUserData, value: RuntimeOwnedEventTag.value)
        cgEvent.post(tap: .cghidEventTap)
    }
}
