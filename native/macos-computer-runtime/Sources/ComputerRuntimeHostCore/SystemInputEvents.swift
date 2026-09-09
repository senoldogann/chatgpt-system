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
            let button = cgMouseButton(dragButton ?? .left)
            switch dragButton {
            case .left:
                type = .leftMouseDragged
            case .right:
                type = .rightMouseDragged
            case .middle:
                type = .otherMouseDragged
            case nil:
                type = .mouseMoved
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

        case let .mouseButton(button, down, point, clickCount):
            guard (1...2).contains(clickCount),
                  let created = CGEvent(
                    mouseEventSource: source,
                    mouseType: mouseEventType(button: button, down: down),
                    mouseCursorPosition: CGPoint(x: point.x, y: point.y),
                    mouseButton: cgMouseButton(button)
                  )
            else {
                throw ComputerInputError.unavailable
            }
            created.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
            cgEvent = created

        case let .scroll(vertical, horizontal):
            guard let created = CGEvent(
                scrollWheelEvent2Source: source,
                units: .line,
                wheelCount: 2,
                wheel1: vertical,
                wheel2: horizontal,
                wheel3: 0
            ) else {
                throw ComputerInputError.unavailable
            }
            cgEvent = created

        case .key, .unicode:
            throw ComputerInputError.unavailable
        }

        cgEvent.setIntegerValueField(.eventSourceUserData, value: RuntimeOwnedEventTag.value)
        cgEvent.post(tap: .cghidEventTap)
    }

    private func cgMouseButton(_ button: ComputerMouseButton) -> CGMouseButton {
        switch button {
        case .left: .left
        case .right: .right
        case .middle: .center
        }
    }

    private func mouseEventType(button: ComputerMouseButton, down: Bool) -> CGEventType {
        switch (button, down) {
        case (.left, true): .leftMouseDown
        case (.left, false): .leftMouseUp
        case (.right, true): .rightMouseDown
        case (.right, false): .rightMouseUp
        case (.middle, true): .otherMouseDown
        case (.middle, false): .otherMouseUp
        }
    }
}
