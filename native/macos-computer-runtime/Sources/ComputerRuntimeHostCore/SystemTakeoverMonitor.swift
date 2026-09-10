import ComputerRuntimeCore
import CoreFoundation
import CoreGraphics
import Dispatch
import Foundation

enum SystemTakeoverMonitorError: Error, Equatable, Sendable {
    case monitorUnavailable
}

final class SystemTakeoverMonitor: TakeoverMonitoring, @unchecked Sendable {
    private let coordinator: InputSafetyCoordinator
    private let lock = NSLock()
    private var eventTap: CFMachPort?
    private var runLoop: CFRunLoop?
    private var thread: Thread?
    private var started = false
    private var ready = false

    init(coordinator: InputSafetyCoordinator) {
        self.coordinator = coordinator
    }

    func start() throws {
        lock.lock()
        if started {
            lock.unlock()
            return
        }
        lock.unlock()

        guard CGPreflightListenEventAccess() else {
            coordinator.markMonitorUnavailable()
            throw SystemTakeoverMonitorError.monitorUnavailable
        }

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: Self.eventMask,
            callback: Self.eventTapCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            coordinator.markMonitorUnavailable()
            throw SystemTakeoverMonitorError.monitorUnavailable
        }

        let readiness = DispatchSemaphore(value: 0)
        let worker = Thread { [weak self] in
            guard let self else {
                readiness.signal()
                return
            }
            self.runMonitorThread(readiness: readiness)
        }
        worker.name = "ChatGPTSystemComputerRuntime.InputSafety"

        lock.lock()
        eventTap = tap
        thread = worker
        started = true
        ready = false
        lock.unlock()

        coordinator.markMonitorUnavailable()
        worker.start()

        guard readiness.wait(timeout: .now() + .seconds(1)) == .success else {
            stop()
            coordinator.markMonitorUnavailable()
            throw SystemTakeoverMonitorError.monitorUnavailable
        }

        lock.lock()
        let isReady = started && ready
        lock.unlock()
        guard isReady else {
            stop()
            coordinator.markMonitorUnavailable()
            throw SystemTakeoverMonitorError.monitorUnavailable
        }
        coordinator.markMonitorAvailable()
    }

    func stop() {
        lock.lock()
        let tap = eventTap
        let runLoop = runLoop
        eventTap = nil
        self.runLoop = nil
        thread = nil
        started = false
        ready = false
        lock.unlock()

        if let tap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        if let runLoop {
            CFRunLoopStop(runLoop)
        }
    }

    static func shouldReenableTap(for type: CGEventType) -> Bool {
        type == .tapDisabledByTimeout || type == .tapDisabledByUserInput
    }

    static func classify(type: CGEventType, event: CGEvent) -> ObservedPhysicalInput? {
        let sourceTag = event.getIntegerValueField(.eventSourceUserData)
        guard sourceTag != RuntimeOwnedEventTag.value else { return nil }

        let kind: ObservedPhysicalInput.Kind
        let location: ComputerPoint?
        switch type {
        case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
            kind = .pointerMoved
            let point = event.location
            location = ComputerPoint(x: point.x, y: point.y)
        case .leftMouseDown, .leftMouseUp,
             .rightMouseDown, .rightMouseUp,
             .otherMouseDown, .otherMouseUp:
            kind = .mouseButton
            let point = event.location
            location = ComputerPoint(x: point.x, y: point.y)
        case .scrollWheel:
            kind = .scroll
            location = nil
        case .keyDown, .keyUp:
            kind = .key
            location = nil
        case .flagsChanged:
            kind = .flagsChanged
            location = nil
        default:
            return nil
        }

        let emergencyChord: Bool
        if type == .keyDown,
           event.getIntegerValueField(.keyboardEventKeycode) == Int64(KeyMapping.keyCode(for: "escape") ?? UInt16.max)
        {
            let flags = event.flags
            emergencyChord = flags.contains(.maskControl)
                && flags.contains(.maskAlternate)
                && flags.contains(.maskCommand)
                && !flags.contains(.maskShift)
        } else {
            emergencyChord = false
        }

        return ObservedPhysicalInput(
            kind: kind,
            location: location,
            sourceTag: sourceTag,
            emergencyChord: emergencyChord
        )
    }

    private func runMonitorThread(readiness: DispatchSemaphore) {
        lock.lock()
        guard started, let tap = eventTap else {
            lock.unlock()
            readiness.signal()
            return
        }
        lock.unlock()

        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            coordinator.markMonitorUnavailable()
            readiness.signal()
            return
        }

        let currentRunLoop = CFRunLoopGetCurrent()
        lock.lock()
        guard started else {
            lock.unlock()
            readiness.signal()
            return
        }
        runLoop = currentRunLoop
        lock.unlock()

        CFRunLoopAddSource(currentRunLoop, source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        guard CGEvent.tapIsEnabled(tap: tap) else {
            coordinator.markMonitorUnavailable()
            CFRunLoopRemoveSource(currentRunLoop, source, .commonModes)
            readiness.signal()
            return
        }

        lock.lock()
        ready = true
        lock.unlock()
        readiness.signal()

        CFRunLoopRun()
        CFRunLoopRemoveSource(currentRunLoop, source, .commonModes)
    }

    private func handle(type: CGEventType, event: CGEvent) {
        if Self.shouldReenableTap(for: type) {
            reenableTap()
            return
        }
        guard let observed = Self.classify(type: type, event: event) else { return }
        coordinator.observe(observed)
    }

    private func reenableTap() {
        lock.lock()
        let tap = eventTap
        lock.unlock()
        guard let tap else {
            coordinator.markMonitorUnavailable()
            return
        }
        CGEvent.tapEnable(tap: tap, enable: true)
        recordReenableResult(tapIsEnabled: CGEvent.tapIsEnabled(tap: tap))
    }

    func recordReenableResult(tapIsEnabled: Bool) {
        lock.lock()
        ready = tapIsEnabled
        lock.unlock()

        if tapIsEnabled {
            coordinator.markMonitorAvailable()
        } else {
            coordinator.markMonitorUnavailable()
        }
    }

    private static let eventTapCallback: CGEventTapCallBack = { _, type, event, userInfo in
        guard let userInfo else {
            return Unmanaged.passUnretained(event)
        }
        let monitor = Unmanaged<SystemTakeoverMonitor>.fromOpaque(userInfo).takeUnretainedValue()
        monitor.handle(type: type, event: event)
        return Unmanaged.passUnretained(event)
    }

    private static let eventMask: CGEventMask = {
        let types: [CGEventType] = [
            .mouseMoved,
            .leftMouseDown, .leftMouseUp,
            .rightMouseDown, .rightMouseUp,
            .otherMouseDown, .otherMouseUp,
            .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
            .scrollWheel,
            .keyDown, .keyUp,
            .flagsChanged,
        ]
        return types.reduce(CGEventMask(0)) { mask, type in
            mask | (CGEventMask(1) << CGEventMask(type.rawValue))
        }
    }()
}
