import Carbon.HIToolbox
import ComputerRuntimeCore

struct KeyMapping {
    static let modifierDownOrder: [ComputerKeyModifier] = [.control, .option, .shift, .command]
    static let modifierReleaseOrder: [ComputerKeyModifier] = modifierDownOrder.reversed()

    static func keyCode(for name: String) -> UInt16? {
        let value: Int
        switch name {
        case "a": value = kVK_ANSI_A
        case "b": value = kVK_ANSI_B
        case "c": value = kVK_ANSI_C
        case "d": value = kVK_ANSI_D
        case "e": value = kVK_ANSI_E
        case "f": value = kVK_ANSI_F
        case "g": value = kVK_ANSI_G
        case "h": value = kVK_ANSI_H
        case "i": value = kVK_ANSI_I
        case "j": value = kVK_ANSI_J
        case "k": value = kVK_ANSI_K
        case "l": value = kVK_ANSI_L
        case "m": value = kVK_ANSI_M
        case "n": value = kVK_ANSI_N
        case "o": value = kVK_ANSI_O
        case "p": value = kVK_ANSI_P
        case "q": value = kVK_ANSI_Q
        case "r": value = kVK_ANSI_R
        case "s": value = kVK_ANSI_S
        case "t": value = kVK_ANSI_T
        case "u": value = kVK_ANSI_U
        case "v": value = kVK_ANSI_V
        case "w": value = kVK_ANSI_W
        case "x": value = kVK_ANSI_X
        case "y": value = kVK_ANSI_Y
        case "z": value = kVK_ANSI_Z
        case "0": value = kVK_ANSI_0
        case "1": value = kVK_ANSI_1
        case "2": value = kVK_ANSI_2
        case "3": value = kVK_ANSI_3
        case "4": value = kVK_ANSI_4
        case "5": value = kVK_ANSI_5
        case "6": value = kVK_ANSI_6
        case "7": value = kVK_ANSI_7
        case "8": value = kVK_ANSI_8
        case "9": value = kVK_ANSI_9
        case "return": value = kVK_Return
        case "tab": value = kVK_Tab
        case "space": value = kVK_Space
        case "delete": value = kVK_Delete
        case "forward_delete": value = kVK_ForwardDelete
        case "escape": value = kVK_Escape
        case "left": value = kVK_LeftArrow
        case "right": value = kVK_RightArrow
        case "up": value = kVK_UpArrow
        case "down": value = kVK_DownArrow
        case "home": value = kVK_Home
        case "end": value = kVK_End
        case "page_up": value = kVK_PageUp
        case "page_down": value = kVK_PageDown
        case "f1": value = kVK_F1
        case "f2": value = kVK_F2
        case "f3": value = kVK_F3
        case "f4": value = kVK_F4
        case "f5": value = kVK_F5
        case "f6": value = kVK_F6
        case "f7": value = kVK_F7
        case "f8": value = kVK_F8
        case "f9": value = kVK_F9
        case "f10": value = kVK_F10
        case "f11": value = kVK_F11
        case "f12": value = kVK_F12
        default: return nil
        }
        return UInt16(value)
    }

    static func modifierKeyCode(for modifier: ComputerKeyModifier) -> UInt16 {
        let value: Int
        switch modifier {
        case .control: value = kVK_Control
        case .option: value = kVK_Option
        case .shift: value = kVK_Shift
        case .command: value = kVK_Command
        }
        return UInt16(value)
    }
}
