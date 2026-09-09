import ComputerRuntimeCore
import Foundation

enum InputSafetyInterruption: Error, Equatable, Sendable {
    case userTakeover
    case emergencyStop
}

struct ObservedPhysicalInput: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case pointerMoved
        case mouseButton
        case scroll
        case key
        case flagsChanged
    }

    let kind: Kind
    let location: ComputerPoint?
    let sourceTag: Int64
    let emergencyChord: Bool
}

final class InputSafetyCoordinator: @unchecked Sendable {
    private static let pointerTolerance = 18.0

    private let lock = NSLock()
    private var active = false
    private var expectedPointer: ComputerPoint?
    private var interruption: InputSafetyInterruption?
    private var monitorAvailable = true

    func beginAction(expectedPointer: ComputerPoint?) {
        lock.lock()
        active = true
        self.expectedPointer = expectedPointer
        interruption = nil
        lock.unlock()
    }

    func updateExpectedPointer(_ point: ComputerPoint?) {
        lock.lock()
        guard active else {
            lock.unlock()
            return
        }
        expectedPointer = point
        lock.unlock()
    }

    func observe(_ input: ObservedPhysicalInput) {
        lock.lock()
        defer { lock.unlock() }

        guard active, interruption == nil else { return }
        guard input.sourceTag != RuntimeOwnedEventTag.value else { return }

        if input.emergencyChord {
            interruption = .emergencyStop
            return
        }

        switch input.kind {
        case .pointerMoved:
            guard let expectedPointer, let location = input.location else { return }
            let distance = hypot(location.x - expectedPointer.x, location.y - expectedPointer.y)
            if distance > Self.pointerTolerance {
                interruption = .userTakeover
            }
        case .mouseButton, .scroll, .key, .flagsChanged:
            interruption = .userTakeover
        }
    }

    func checkForInterruption() throws {
        lock.lock()
        let interruption = self.interruption
        let monitorAvailable = self.monitorAvailable
        let active = self.active
        lock.unlock()
        if active, !monitorAvailable {
            throw ComputerInputError.unavailable
        }
        if let interruption {
            throw interruption
        }
    }

    func markMonitorAvailable() {
        lock.lock()
        monitorAvailable = true
        lock.unlock()
    }

    func markMonitorUnavailable() {
        lock.lock()
        monitorAvailable = false
        lock.unlock()
    }

    func endAction() {
        lock.lock()
        active = false
        expectedPointer = nil
        interruption = nil
        lock.unlock()
    }

    func triggerEmergencyStop() {
        lock.lock()
        if active, interruption == nil {
            interruption = .emergencyStop
        }
        lock.unlock()
    }
}
