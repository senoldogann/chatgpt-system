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

        switch event {
        case let .mouseMove(point, dragButton):
            let type: CGEventType
            let button = cgMouseButton(dragButton ?? .left)
            switch dragButton {
            case .left: type = .leftMouseDragged
            case .right: type = .rightMouseDragged
            case .middle: type = .otherMouseDragged
            case nil: type = .mouseMoved
            }
            guard let created = CGEvent(
                mouseEventSource: source,
                mouseType: type,
                mouseCursorPosition: CGPoint(x: point.x, y: point.y),
                mouseButton: button
            ) else {
                throw ComputerInputError.unavailable
            }
            postTagged(created)

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
            postTagged(created)

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
            postTagged(created)

        case let .key(keyCode, down, modifiers):
            guard let created = CGEvent(
                keyboardEventSource: source,
                virtualKey: CGKeyCode(keyCode),
                keyDown: down
            ) else {
                throw ComputerInputError.unavailable
            }
            created.flags = eventFlags(for: modifiers)
            postTagged(created)

        case let .unicode(value):
            let utf16 = Array(value.utf16)
            guard !utf16.isEmpty, utf16.count <= 20,
                  let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            else {
                throw ComputerInputError.unavailable
            }
            utf16.withUnsafeBufferPointer { buffer in
                guard let baseAddress = buffer.baseAddress else { return }
                down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: baseAddress)
                up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: baseAddress)
            }
            postTagged(down)
            postTagged(up)
        }
    }

    private func postTagged(_ event: CGEvent) {
        event.setIntegerValueField(.eventSourceUserData, value: RuntimeOwnedEventTag.value)
        event.post(tap: .cghidEventTap)
    }

    private func eventFlags(for modifiers: Set<ComputerKeyModifier>) -> CGEventFlags {
        var flags: CGEventFlags = []
        if modifiers.contains(.control) { flags.insert(.maskControl) }
        if modifiers.contains(.option) { flags.insert(.maskAlternate) }
        if modifiers.contains(.shift) { flags.insert(.maskShift) }
        if modifiers.contains(.command) { flags.insert(.maskCommand) }
        return flags
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
