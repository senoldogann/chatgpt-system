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

    func testSemanticClickResolvesImmediatelyBeforePhysicalMutation() async throws {
        let sink = ActionRecordingSink()
        let recovery = ActionFakeRecovery(
            resolved: actionResolvedTarget(x: 120, y: 80),
            error: nil
        )
        let service = makeActionHostService(
            pointer: ComputerPoint(x: 0, y: 0),
            sink: sink,
            recovery: recovery
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "semantic-click",
            method: "click",
            params: .object([
                "target": .object([
                    "by": .string("role"),
                    "role": .string("AXButton"),
                    "name": .string("Submit"),
                    "exact": .bool(true),
                ]),
                "motionMode": .string("instant"),
            ])
        ))

        XCTAssertTrue(response.ok)
        let resolveCalls = await recovery.resolveCallCount
        XCTAssertEqual(resolveCalls, 1)
        XCTAssertEqual(sink.events, [
            .mouseMove(point: ComputerPoint(x: 120, y: 80), dragButton: nil),
            .mouseButton(button: .left, down: true, point: ComputerPoint(x: 120, y: 80), clickCount: 1),
            .mouseButton(button: .left, down: false, point: ComputerPoint(x: 120, y: 80), clickCount: 1),
        ])
    }

    func testSemanticMoveUsesResolvedPointWithoutGuessedCoordinates() async {
        let sink = ActionRecordingSink()
        let recovery = ActionFakeRecovery(resolved: actionResolvedTarget(x: 75, y: 45), error: nil)
        let service = makeActionHostService(
            pointer: ComputerPoint(x: 0, y: 0),
            sink: sink,
            recovery: recovery
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "semantic-move",
            method: "move_mouse",
            params: .object([
                "target": .object(["by": .string("text"), "text": .string("Move Here")]),
                "motionMode": .string("instant"),
            ])
        ))

        XCTAssertTrue(response.ok)
        XCTAssertEqual(sink.events, [.mouseMove(point: ComputerPoint(x: 75, y: 45), dragButton: nil)])
    }

    func testSemanticDragResolvesBothEndpointsBeforeMutation() async {
        let sink = ActionRecordingSink()
        let recovery = ActionFakeRecovery(
            resolved: nil,
            manyResolved: [
                actionResolvedTarget(x: 20, y: 30),
                actionResolvedTarget(x: 140, y: 160),
            ],
            error: nil
        )
        let service = makeActionHostService(
            pointer: ComputerPoint(x: 0, y: 0),
            sink: sink,
            recovery: recovery
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "semantic-drag",
            method: "drag",
            params: .object([
                "from": .object(["by": .string("text"), "text": .string("Source")]),
                "to": .object(["by": .string("text"), "text": .string("Destination")]),
                "motionMode": .string("instant"),
            ])
        ))

        XCTAssertTrue(response.ok)
        let resolveManyCalls = await recovery.resolveManyCallCount
        XCTAssertEqual(resolveManyCalls, 1)
        XCTAssertEqual(sink.events, [
            .mouseMove(point: ComputerPoint(x: 20, y: 30), dragButton: nil),
            .mouseButton(button: .left, down: true, point: ComputerPoint(x: 20, y: 30), clickCount: 1),
            .mouseMove(point: ComputerPoint(x: 140, y: 160), dragButton: .left),
            .mouseButton(button: .left, down: false, point: ComputerPoint(x: 140, y: 160), clickCount: 1),
        ])
    }

    func testSemanticPositionedScrollResolvesTargetBeforeScroll() async {
        let sink = ActionRecordingSink()
        let recovery = ActionFakeRecovery(resolved: actionResolvedTarget(x: 200, y: 100), error: nil)
        let service = makeActionHostService(
            pointer: ComputerPoint(x: 0, y: 0),
            sink: sink,
            recovery: recovery
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "semantic-scroll",
            method: "scroll",
            params: .object([
                "vertical": .number(-3),
                "horizontal": .number(2),
                "target": .object(["by": .string("text"), "text": .string("Scroll Area")]),
                "motionMode": .string("instant"),
            ])
        ))

        XCTAssertTrue(response.ok)
        XCTAssertEqual(sink.events, [
            .mouseMove(point: ComputerPoint(x: 200, y: 100), dragButton: nil),
            .scroll(vertical: -3, horizontal: 2),
        ])
    }

    func testSemanticClickNeedsReplanDoesNotEmitPhysicalInput() async {
        let sink = ActionRecordingSink()
        let recovery = ActionFakeRecovery(resolved: nil, error: .needsReplan)
        let service = makeActionHostService(
            pointer: ComputerPoint(x: 0, y: 0),
            sink: sink,
            recovery: recovery
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "semantic-click-replan",
            method: "click",
            params: .object([
                "target": .object(["by": .string("text"), "text": .string("Submit")]),
                "motionMode": .string("instant"),
            ])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_NEEDS_REPLAN")
        XCTAssertTrue(sink.events.isEmpty)
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
    sink: ActionRecordingSink = ActionRecordingSink(),
    recovery: (any ComputerRecoveryHandling)? = nil
) -> ComputerHostService {
    sink.configurePointer(pointer)
    let controller = ComputerInputController(
        eventSink: sink,
        pointerReader: ActionPointerReader(sink: sink),
        displayTopology: ActionDisplayTopology(),
        sleeper: ActionImmediateSleeper()
    )
    let actions = ComputerActionService(controller: controller, recovery: recovery)
    return ComputerHostService(
        permissions: ActionPermissions(),
        workspace: ActionWorkspace(),
        actions: actions
    )
}

private actor ActionFakeRecovery: ComputerRecoveryHandling {
    let resolved: ResolvedComputerTarget?
    let manyResolved: [ResolvedComputerTarget]?
    let error: ComputerRecoveryError?
    private(set) var resolveCallCount = 0
    private(set) var resolveManyCallCount = 0

    init(
        resolved: ResolvedComputerTarget?,
        manyResolved: [ResolvedComputerTarget]? = nil,
        error: ComputerRecoveryError?
    ) {
        self.resolved = resolved
        self.manyResolved = manyResolved
        self.error = error
    }

    func resolve(_ target: ComputerTarget, retryBudget: Int) async throws -> ResolvedComputerTarget {
        resolveCallCount += 1
        if let error { throw error }
        return resolved!
    }

    func resolveMany(_ targets: [ComputerTarget], retryBudget: Int) async throws -> [ResolvedComputerTarget] {
        resolveManyCallCount += 1
        if let error { throw error }
        if let manyResolved { return manyResolved }
        guard let resolved else { return [] }
        return targets.map { _ in resolved }
    }

    func refreshObservation() async throws -> ComputerObservation {
        ComputerObservation(
            snapshotId: "action-fake",
            application: ApplicationView(name: "Fixture", bundleIdentifier: "com.example.fixture", frontmost: true),
            windowTitle: nil,
            elements: [],
            truncated: false
        )
    }
}

private func actionResolvedTarget(x: Double, y: Double) -> ResolvedComputerTarget {
    ResolvedComputerTarget(
        source: .ax,
        bounds: ComputerBounds(x: x - 10, y: y - 10, width: 20, height: 20),
        actionPoint: ComputerPoint(x: x, y: y),
        observationId: "obs-action",
        appIdentity: "com.example.fixture",
        windowIdentity: "window",
        windowGeneration: "generation",
        displayTopologyDigest: "topology",
        confidence: .deterministic,
        semanticFingerprint: "fingerprint"
    )
}

private func decodeActionResult<T: Decodable>(_ type: T.Type, from response: ComputerProtocolResponse) throws -> T {
    let result = try XCTUnwrap(response.result)
    let data = try JSONEncoder().encode(result)
    return try JSONDecoder().decode(type, from: data)
}
