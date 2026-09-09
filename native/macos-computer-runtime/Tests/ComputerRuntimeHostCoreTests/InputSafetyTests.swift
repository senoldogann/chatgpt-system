import Foundation
import CoreGraphics
import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class InputSafetyTests: XCTestCase {
    func testOwnedSyntheticEventIsIgnored() throws {
        let coordinator = InputSafetyCoordinator()
        coordinator.beginAction(expectedPointer: ComputerPoint(x: 100, y: 100))

        coordinator.observe(.init(
            kind: .mouseButton,
            location: ComputerPoint(x: 500, y: 500),
            sourceTag: RuntimeOwnedEventTag.value,
            emergencyChord: false
        ))

        XCTAssertNoThrow(try coordinator.checkForInterruption())
    }

    func testUnownedPointerWithinToleranceDoesNotTakeOver() throws {
        let coordinator = InputSafetyCoordinator()
        coordinator.beginAction(expectedPointer: ComputerPoint(x: 100, y: 100))

        coordinator.observe(.init(
            kind: .pointerMoved,
            location: ComputerPoint(x: 118, y: 100),
            sourceTag: 0,
            emergencyChord: false
        ))

        XCTAssertNoThrow(try coordinator.checkForInterruption())
    }

    func testUnownedPointerBeyond18PixelsTriggersTakeover() {
        let coordinator = InputSafetyCoordinator()
        coordinator.beginAction(expectedPointer: ComputerPoint(x: 100, y: 100))

        coordinator.observe(.init(
            kind: .pointerMoved,
            location: ComputerPoint(x: 118.01, y: 100),
            sourceTag: 0,
            emergencyChord: false
        ))

        XCTAssertThrowsError(try coordinator.checkForInterruption()) { error in
            XCTAssertEqual(error as? InputSafetyInterruption, .userTakeover)
        }
    }

    func testUnownedMouseButtonScrollOrKeyTriggersTakeoverDuringAction() {
        for kind in [ObservedPhysicalInput.Kind.mouseButton, .scroll, .key, .flagsChanged] {
            let coordinator = InputSafetyCoordinator()
            coordinator.beginAction(expectedPointer: ComputerPoint(x: 10, y: 10))
            coordinator.observe(.init(kind: kind, location: nil, sourceTag: 0, emergencyChord: false))

            XCTAssertThrowsError(try coordinator.checkForInterruption()) { error in
                XCTAssertEqual(error as? InputSafetyInterruption, .userTakeover)
            }
        }
    }

    func testInputOutsideActiveActionDoesNotPoisonNextAction() throws {
        let coordinator = InputSafetyCoordinator()
        coordinator.observe(.init(kind: .key, location: nil, sourceTag: 0, emergencyChord: false))

        coordinator.beginAction(expectedPointer: ComputerPoint(x: 0, y: 0))
        XCTAssertNoThrow(try coordinator.checkForInterruption())
        coordinator.endAction()
    }

    func testEmergencyChordTriggersEmergencyInterruption() {
        let coordinator = InputSafetyCoordinator()
        coordinator.beginAction(expectedPointer: ComputerPoint(x: 0, y: 0))

        coordinator.observe(.init(kind: .key, location: nil, sourceTag: 0, emergencyChord: true))

        XCTAssertThrowsError(try coordinator.checkForInterruption()) { error in
            XCTAssertEqual(error as? InputSafetyInterruption, .emergencyStop)
        }
    }

    func testEmergencySyntheticChordIsIgnoredBecauseItIsRuntimeOwned() throws {
        let coordinator = InputSafetyCoordinator()
        coordinator.beginAction(expectedPointer: ComputerPoint(x: 0, y: 0))

        coordinator.observe(.init(
            kind: .key,
            location: nil,
            sourceTag: RuntimeOwnedEventTag.value,
            emergencyChord: true
        ))

        XCTAssertNoThrow(try coordinator.checkForInterruption())
    }

    func testTakeoverDuringDragCausesControllerToReleaseHeldButton() async {
        let coordinator = InputSafetyCoordinator()
        let pointer = SafetyPointerState(ComputerPoint(x: 20, y: 20))
        let sink = SafetyRecordingSink(pointer: pointer)
        sink.onEvent = { event in
            if case .mouseButton(button: .left, down: true, _, _) = event {
                coordinator.observe(.init(
                    kind: .pointerMoved,
                    location: ComputerPoint(x: 500, y: 500),
                    sourceTag: 0,
                    emergencyChord: false
                ))
            }
        }
        let controller = makeSafetyController(
            coordinator: coordinator,
            pointer: pointer,
            sink: sink
        )

        do {
            _ = try await controller.drag(
                from: ComputerPoint(x: 20, y: 20),
                to: ComputerPoint(x: 200, y: 200),
                button: .left,
                mode: .instant
            )
            XCTFail("Expected user takeover")
        } catch {
            XCTAssertEqual(error as? InputSafetyInterruption, .userTakeover)
        }

        let held = await controller.heldInputState()
        XCTAssertTrue(held.isEmpty)
        XCTAssertTrue(sink.events.contains { event in
            if case .mouseButton(button: .left, down: false, _, _) = event { return true }
            return false
        })
    }

    func testEmergencyStopDuringHeldInputCausesRelease() async {
        let coordinator = InputSafetyCoordinator()
        let pointer = SafetyPointerState(ComputerPoint(x: 30, y: 30))
        let sink = SafetyRecordingSink(pointer: pointer)
        sink.onEvent = { event in
            if case .mouseButton(button: .right, down: true, _, _) = event {
                coordinator.triggerEmergencyStop()
            }
        }
        let controller = makeSafetyController(
            coordinator: coordinator,
            pointer: pointer,
            sink: sink
        )

        do {
            _ = try await controller.mouseDown(.right)
            XCTFail("Expected emergency stop")
        } catch {
            XCTAssertEqual(error as? InputSafetyInterruption, .emergencyStop)
        }

        let held = await controller.heldInputState()
        XCTAssertTrue(held.isEmpty)
        XCTAssertTrue(sink.events.contains { event in
            if case .mouseButton(button: .right, down: false, _, _) = event { return true }
            return false
        })
    }

    func testSafetyNativeErrorTextIsNeverProtocolOutput() async throws {
        let coordinator = InputSafetyCoordinator()
        let pointer = SafetyPointerState(ComputerPoint(x: 10, y: 10))
        let sink = SafetyRecordingSink(pointer: pointer, error: SafetyNativeError.failure("native-safety-secret"))
        let controller = makeSafetyController(coordinator: coordinator, pointer: pointer, sink: sink)
        let service = ComputerHostService(
            permissions: SafetyPermissions(),
            workspace: SafetyWorkspace(),
            actions: ComputerActionService(controller: controller)
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "safety-redaction",
            method: "click",
            params: .object([
                "x": .number(10),
                "y": .number(10),
                "motionMode": .string("instant"),
            ])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_ACTION_FAILED")
        let encoded = String(decoding: try JSONEncoder().encode(response), as: UTF8.self)
        XCTAssertFalse(encoded.contains("native-safety-secret"))
    }

    func testProtocolMapsTakeoverAndEmergencyToStableUserTakeoverError() async {
        for emergency in [false, true] {
            let coordinator = InputSafetyCoordinator()
            let pointer = SafetyPointerState(ComputerPoint(x: 10, y: 10))
            let sink = SafetyRecordingSink(pointer: pointer)
            sink.onEvent = { event in
                guard case .mouseMove = event else { return }
                if emergency {
                    coordinator.triggerEmergencyStop()
                } else {
                    coordinator.observe(.init(
                        kind: .key,
                        location: nil,
                        sourceTag: 0,
                        emergencyChord: false
                    ))
                }
            }
            let controller = makeSafetyController(coordinator: coordinator, pointer: pointer, sink: sink)
            let service = ComputerHostService(
                permissions: SafetyPermissions(),
                workspace: SafetyWorkspace(),
                actions: ComputerActionService(controller: controller)
            )

            let response = await service.handle(.init(
                protocolVersion: 1,
                requestId: emergency ? "emergency" : "takeover",
                method: "move_mouse",
                params: .object([
                    "x": .number(20),
                    "y": .number(20),
                    "motionMode": .string("instant"),
                ])
            ))

            XCTAssertFalse(response.ok)
            XCTAssertEqual(response.error?.code, "COMPUTER_USER_TAKEOVER")
            XCTAssertEqual(response.error?.message, "User took over computer input.")
        }
    }

    func testSystemMonitorClassifierDropsRuntimeOwnedEvents() throws {
        let source = try XCTUnwrap(CGEventSource(stateID: .privateState))
        let event = try XCTUnwrap(CGEvent(keyboardEventSource: source, virtualKey: 53, keyDown: true))
        event.setIntegerValueField(.eventSourceUserData, value: RuntimeOwnedEventTag.value)

        XCTAssertNil(SystemTakeoverMonitor.classify(type: .keyDown, event: event))
    }

    func testSystemMonitorClassifierRecognizesFixedEmergencyChord() throws {
        let source = try XCTUnwrap(CGEventSource(stateID: .privateState))
        let event = try XCTUnwrap(CGEvent(keyboardEventSource: source, virtualKey: 53, keyDown: true))
        event.flags = [.maskControl, .maskAlternate, .maskCommand]

        let observed = try XCTUnwrap(SystemTakeoverMonitor.classify(type: .keyDown, event: event))
        XCTAssertEqual(observed.kind, .key)
        XCTAssertTrue(observed.emergencyChord)
        XCTAssertEqual(observed.sourceTag, 0)
        XCTAssertNil(observed.location)
    }

}

private enum SafetyNativeError: Error {
    case failure(String)
}

private final class SafetyPointerState: @unchecked Sendable {
    private let lock = NSLock()
    private var point: ComputerPoint

    init(_ point: ComputerPoint) { self.point = point }

    func get() -> ComputerPoint {
        lock.lock(); defer { lock.unlock() }
        return point
    }

    func set(_ point: ComputerPoint) {
        lock.lock(); self.point = point; lock.unlock()
    }
}

private final class SafetyRecordingSink: InputEventSink, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [InputEvent] = []
    private let pointer: SafetyPointerState
    private let error: Error?
    var onEvent: (@Sendable (InputEvent) -> Void)?

    init(pointer: SafetyPointerState, error: Error? = nil) {
        self.pointer = pointer
        self.error = error
    }

    var events: [InputEvent] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func emit(_ event: InputEvent) throws {
        lock.lock(); storage.append(event); lock.unlock()
        switch event {
        case let .mouseMove(point, _), let .mouseButton(_, _, point, _): pointer.set(point)
        case .scroll, .key, .unicode: break
        }
        onEvent?(event)
        if let error { throw error }
    }
}

private struct SafetyPointerReader: PointerReading {
    let state: SafetyPointerState
    func currentPointerPosition() throws -> ComputerPoint { state.get() }
}

private struct SafetyDisplays: DisplayTopologyReading {
    func activeDisplayBounds() throws -> [ComputerBounds] {
        [ComputerBounds(x: 0, y: 0, width: 1_000, height: 1_000)]
    }
}

private struct SafetySleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {}
}

private func makeSafetyController(
    coordinator: InputSafetyCoordinator,
    pointer: SafetyPointerState,
    sink: SafetyRecordingSink
) -> ComputerInputController {
    ComputerInputController(
        eventSink: sink,
        pointerReader: SafetyPointerReader(state: pointer),
        displayTopology: SafetyDisplays(),
        sleeper: SafetySleeper(),
        safetyCoordinator: coordinator
    )
}

private struct SafetyPermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { true }
    func screenCaptureAuthorized() -> Bool { false }
}

private struct SafetyWorkspace: WorkspaceReading {
    func runningApplications() -> [WorkspaceApplication] { [] }
    func frontmostApplication() -> WorkspaceApplication? { nil }
}
