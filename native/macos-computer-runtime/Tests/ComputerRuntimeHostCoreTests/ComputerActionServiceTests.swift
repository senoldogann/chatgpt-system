import Foundation
import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class ComputerActionServiceTests: XCTestCase {
    func testPointerPositionAcceptsOnlyEmptyParams() async throws {
        let service = makeActionHostService(pointer: ComputerPoint(x: 25, y: 50))

        let ok = await service.handle(.init(
            protocolVersion: 1,
            requestId: "pointer-ok",
            method: "pointer_position",
            params: .object([:])
        ))
        XCTAssertTrue(ok.ok)
        XCTAssertEqual(try decodeActionResult(ComputerPoint.self, from: ok), ComputerPoint(x: 25, y: 50))

        let invalid = await service.handle(.init(
            protocolVersion: 1,
            requestId: "pointer-invalid",
            method: "pointer_position",
            params: .object(["extra": .bool(true)])
        ))
        XCTAssertFalse(invalid.ok)
        XCTAssertEqual(invalid.error?.code, "COMPUTER_PROTOCOL_INVALID")
    }

    func testMoveMouseRejectsUnknownAndInvalidParams() async {
        let service = makeActionHostService(pointer: ComputerPoint(x: 0, y: 0))
        let invalidParams: [JSONValue] = [
            .object(["x": .number(10), "y": .number(20), "extra": .bool(true)]),
            .object(["x": .string("10"), "y": .number(20)]),
            .object(["x": .number(.infinity), "y": .number(20)]),
            .object(["x": .number(10), "y": .number(20), "motionMode": .string("slow")]),
        ]

        for (index, params) in invalidParams.enumerated() {
            let response = await service.handle(.init(
                protocolVersion: 1,
                requestId: "invalid-\(index)",
                method: "move_mouse",
                params: params
            ))
            XCTAssertFalse(response.ok)
            XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID")
            XCTAssertEqual(response.error?.message, "Invalid computer runtime request.")
        }
    }

    func testMoveMouseDefaultsToFastAndReturnsCompletedEndpoint() async throws {
        let sink = ActionRecordingSink()
        let service = makeActionHostService(pointer: ComputerPoint(x: 0, y: 0), sink: sink)

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "move-default",
            method: "move_mouse",
            params: .object(["x": .number(100), "y": .number(80)])
        ))

        XCTAssertTrue(response.ok)
        let result = try decodeActionResult(ComputerActionResult.self, from: response)
        XCTAssertEqual(result.state, "completed")
        XCTAssertEqual(result.pointer, ComputerPoint(x: 100, y: 80))
        XCTAssertEqual(sink.events.last, .mouseMove(point: ComputerPoint(x: 100, y: 80), dragButton: nil))
        XCTAssertGreaterThan(sink.events.count, 1, "Default mode should be smooth fast motion, not instant teleport")
    }

    func testHeldInputStateStartsEmptyAndTracksExplicitDownState() {
        var state = HeldInputState()
        XCTAssertTrue(state.isEmpty)

        state.mouseButtons.insert(.left)
        state.modifiers.insert(.command)
        state.keyCodes.insert(12)

        XCTAssertFalse(state.isEmpty)
    }
}

private struct ActionPermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { true }
    func screenCaptureAuthorized() -> Bool { false }
}

private struct ActionWorkspace: WorkspaceReading {
    func runningApplications() -> [WorkspaceApplication] { [] }
    func frontmostApplication() -> WorkspaceApplication? { nil }
}

private final class ActionRecordingSink: InputEventSink, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [InputEvent] = []
    private var pointer: ComputerPoint?

    var events: [InputEvent] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func configurePointer(_ point: ComputerPoint) {
        lock.lock(); pointer = point; lock.unlock()
    }

    func currentPointer() throws -> ComputerPoint {
        lock.lock(); defer { lock.unlock() }
        guard let pointer else { throw ComputerInputError.unavailable }
        return pointer
    }

    func emit(_ event: InputEvent) throws {
        lock.lock()
        storage.append(event)
        if case let .mouseMove(point, _) = event { pointer = point }
        lock.unlock()
    }
}

private struct ActionPointerReader: PointerReading {
    let sink: ActionRecordingSink
    func currentPointerPosition() throws -> ComputerPoint { try sink.currentPointer() }
}

private struct ActionDisplayTopology: DisplayTopologyReading {
    func activeDisplayBounds() throws -> [ComputerBounds] {
        [ComputerBounds(x: 0, y: 0, width: 1_728, height: 1_117)]
    }
}

private struct ActionImmediateSleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {}
}

private func makeActionHostService(
    pointer: ComputerPoint,
    sink: ActionRecordingSink = ActionRecordingSink()
) -> ComputerHostService {
    sink.configurePointer(pointer)
    let controller = ComputerInputController(
        eventSink: sink,
        pointerReader: ActionPointerReader(sink: sink),
        displayTopology: ActionDisplayTopology(),
        sleeper: ActionImmediateSleeper()
    )
    return ComputerHostService(
        permissions: ActionPermissions(),
        workspace: ActionWorkspace(),
        actions: ComputerActionService(controller: controller)
    )
}

private func decodeActionResult<T: Decodable>(_ type: T.Type, from response: ComputerProtocolResponse) throws -> T {
    let result = try XCTUnwrap(response.result)
    let data = try JSONEncoder().encode(result)
    return try JSONDecoder().decode(type, from: data)
}
