import Foundation
import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class MouseActionTests: XCTestCase {
    func testSingleClickMovesThenPostsDownUpAtExactTarget() async throws {
        let harness = MouseHarness(point: ComputerPoint(x: 0, y: 0))
        let target = ComputerPoint(x: 100, y: 80)

        let result = try await harness.controller.click(at: target, button: .left, mode: .instant)

        XCTAssertEqual(result.pointer, target)
        XCTAssertEqual(harness.sink.events, [
            .mouseMove(point: target, dragButton: nil),
            .mouseButton(button: .left, down: true, point: target, clickCount: 1),
            .mouseButton(button: .left, down: false, point: target, clickCount: 1),
        ])
    }

    func testClickWaitsForPostedPointerMoveToSettleBeforeMouseDown() async throws {
        let start = ComputerPoint(x: 20, y: 20)
        let target = ComputerPoint(x: 320, y: 240)
        let pointer = LaggingMousePointerState(start: start, staleReadsAfterMove: 1)
        let sink = LaggingMouseSink(pointer: pointer)
        let sleeper = CountingMouseSleeper()
        let controller = ComputerInputController(
            eventSink: sink,
            pointerReader: LaggingMousePointerReader(state: pointer),
            displayTopology: MouseDisplays(),
            sleeper: sleeper
        )

        let result = try await controller.click(at: target, button: .left, mode: .instant)

        XCTAssertEqual(result.pointer, target)
        XCTAssertEqual(sink.events, [
            .mouseMove(point: target, dragButton: nil),
            .mouseButton(button: .left, down: true, point: target, clickCount: 1),
            .mouseButton(button: .left, down: false, point: target, clickCount: 1),
        ])
        let settleSleeps = await sleeper.callCount()
        XCTAssertGreaterThan(settleSleeps, 0)
    }

    func testClickFailsBoundedlyWithoutMouseDownWhenPostedMoveNeverSettles() async {
        let start = ComputerPoint(x: 20, y: 20)
        let target = ComputerPoint(x: 320, y: 240)
        let pointer = LaggingMousePointerState(start: start, staleReadsAfterMove: .max)
        let sink = LaggingMouseSink(pointer: pointer)
        let sleeper = CountingMouseSleeper()
        let controller = ComputerInputController(
            eventSink: sink,
            pointerReader: LaggingMousePointerReader(state: pointer),
            displayTopology: MouseDisplays(),
            sleeper: sleeper
        )

        do {
            _ = try await controller.click(at: target, button: .left, mode: .instant)
            XCTFail("Expected pointer settle failure")
        } catch {
            XCTAssertEqual(error as? ComputerInputError, .unavailable)
        }

        let sleeps = await sleeper.callCount()
        XCTAssertGreaterThan(sleeps, 0)
        XCTAssertLessThanOrEqual(sleeps, 20)
        XCTAssertEqual(sink.events, [.mouseMove(point: target, dragButton: nil)])
    }

    func testDoubleClickUsesClickCountOneThenTwo() async throws {
        let harness = MouseHarness(point: ComputerPoint(x: 10, y: 10))
        let target = ComputerPoint(x: 40, y: 50)

        _ = try await harness.controller.doubleClick(at: target, button: .left, mode: .instant)

        XCTAssertEqual(harness.sink.events, [
            .mouseMove(point: target, dragButton: nil),
            .mouseButton(button: .left, down: true, point: target, clickCount: 1),
            .mouseButton(button: .left, down: false, point: target, clickCount: 1),
            .mouseButton(button: .left, down: true, point: target, clickCount: 2),
            .mouseButton(button: .left, down: false, point: target, clickCount: 2),
        ])
    }

    func testMouseDownAndUpTrackHeldButton() async throws {
        let harness = MouseHarness(point: ComputerPoint(x: 25, y: 30))

        _ = try await harness.controller.mouseDown(.right)
        let heldAfterDown = await harness.controller.heldInputState()
        XCTAssertEqual(heldAfterDown.mouseButtons, [.right])

        _ = try await harness.controller.mouseUp(.right)
        let heldAfterUp = await harness.controller.heldInputState()
        XCTAssertTrue(heldAfterUp.mouseButtons.isEmpty)
    }

    func testDragIsMoveDownDraggedMoveUp() async throws {
        let start = ComputerPoint(x: 20, y: 20)
        let target = ComputerPoint(x: 120, y: 140)
        let harness = MouseHarness(point: start)

        let result = try await harness.controller.drag(from: start, to: target, button: .left, mode: .instant)

        XCTAssertEqual(result.pointer, target)
        XCTAssertEqual(harness.sink.events, [
            .mouseMove(point: start, dragButton: nil),
            .mouseButton(button: .left, down: true, point: start, clickCount: 1),
            .mouseMove(point: target, dragButton: .left),
            .mouseButton(button: .left, down: false, point: target, clickCount: 1),
        ])
        let heldAfterDrag = await harness.controller.heldInputState()
        XCTAssertTrue(heldAfterDrag.isEmpty)
    }

    func testInjectedMidDragFailureReleasesHeldButton() async {
        let start = ComputerPoint(x: 20, y: 20)
        let target = ComputerPoint(x: 300, y: 200)
        let harness = MouseHarness(point: start, failFirstDraggedMove: true)

        do {
            _ = try await harness.controller.drag(from: start, to: target, button: .left, mode: .instant)
            XCTFail("Expected injected drag failure")
        } catch {}

        let heldAfterFailure = await harness.controller.heldInputState()
        XCTAssertTrue(heldAfterFailure.isEmpty)
        XCTAssertTrue(harness.sink.events.contains { event in
            if case .mouseButton(button: .left, down: false, _, _) = event { return true }
            return false
        })
    }

    func testCancellationDuringDragReleasesHeldButton() async throws {
        let start = ComputerPoint(x: 20, y: 20)
        let sleeper = MouseCancellationSleeper()
        let harness = MouseHarness(point: start, sleeper: sleeper)

        let task = Task {
            try await harness.controller.drag(
                from: start,
                to: ComputerPoint(x: 500, y: 300),
                button: .left,
                mode: .fast
            )
        }
        await sleeper.waitUntilSleeping()
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch {}

        let heldAfterCancellation = await harness.controller.heldInputState()
        XCTAssertTrue(heldAfterCancellation.isEmpty)
        XCTAssertTrue(harness.sink.events.contains { event in
            if case .mouseButton(button: .left, down: false, _, _) = event { return true }
            return false
        })
    }

    func testScrollSupportsVerticalAndHorizontalDeltas() async throws {
        let harness = MouseHarness(point: ComputerPoint(x: 10, y: 10))

        let result = try await harness.controller.scroll(vertical: 7, horizontal: -4, at: nil, mode: .fast)

        XCTAssertEqual(result.state, "completed")
        XCTAssertEqual(harness.sink.events, [.scroll(vertical: 7, horizontal: -4)])
    }

    func testScrollRejectsDeltaOutsideBoundWithoutEmitting() async {
        let harness = MouseHarness(point: ComputerPoint(x: 10, y: 10))

        do {
            _ = try await harness.controller.scroll(vertical: 10_001, horizontal: 0, at: nil, mode: .fast)
            XCTFail("Expected bounded scroll failure")
        } catch {
            XCTAssertEqual(error as? ComputerInputError, .invalidInput)
        }
        XCTAssertEqual(harness.sink.events, [])
    }

    func testScrollOptionalPointMovesBeforeScrolling() async throws {
        let harness = MouseHarness(point: ComputerPoint(x: 0, y: 0))
        let target = ComputerPoint(x: 200, y: 100)

        _ = try await harness.controller.scroll(vertical: -3, horizontal: 2, at: target, mode: .instant)

        XCTAssertEqual(harness.sink.events, [
            .mouseMove(point: target, dragButton: nil),
            .scroll(vertical: -3, horizontal: 2),
        ])
    }

    func testPhysicalActionsRemainSerialized() async throws {
        let sleeper = MouseFirstSleepGate()
        let harness = MouseHarness(point: ComputerPoint(x: 0, y: 0), sleeper: sleeper)

        let first = Task {
            try await harness.controller.click(
                at: ComputerPoint(x: 100, y: 0),
                button: .left,
                mode: .fast
            )
        }
        await sleeper.waitUntilFirstSleepBegins()
        XCTAssertEqual(harness.sink.events.count, 0)

        let second = Task {
            try await harness.controller.scroll(vertical: 1, horizontal: 0, at: nil, mode: .fast)
        }
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(harness.sink.events.count, 0)

        await sleeper.releaseFirstSleep()
        _ = try await first.value
        _ = try await second.value
        XCTAssertEqual(harness.sink.events.last, .scroll(vertical: 1, horizontal: 0))
    }

    func testMouseProtocolRejectsUnknownParams() async {
        let harness = MouseHarness(point: ComputerPoint(x: 0, y: 0))
        let service = ComputerHostService(
            permissions: MousePermissions(),
            workspace: MouseWorkspace(),
            actions: ComputerActionService(controller: harness.controller)
        )
        let cases: [(String, JSONValue)] = [
            ("click", .object(["x": .number(1), "y": .number(2), "extra": .bool(true)])),
            ("double_click", .object(["x": .number(1), "y": .number(2), "button": .string("side")])),
            ("mouse_down", .object(["button": .string("left"), "extra": .bool(true)])),
            ("mouse_up", .object(["button": .string("left"), "extra": .bool(true)])),
            ("drag", .object(["from": .object(["x": .number(1), "y": .number(2)]), "to": .object(["x": .number(3), "y": .number(4)]), "extra": .bool(true)])),
            ("scroll", .object(["vertical": .number(1), "horizontal": .number(0), "x": .number(2)])),
        ]

        for (method, params) in cases {
            let response = await service.handle(.init(
                protocolVersion: 1,
                requestId: method,
                method: method,
                params: params
            ))
            XCTAssertFalse(response.ok)
            XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID")
        }
    }
}

private final class MousePointerState: @unchecked Sendable {
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

private final class MouseRecordingSink: InputEventSink, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [InputEvent] = []
    private let pointer: MousePointerState
    private let failFirstDraggedMove: Bool
    private var hasFailedDraggedMove = false

    init(pointer: MousePointerState, failFirstDraggedMove: Bool) {
        self.pointer = pointer
        self.failFirstDraggedMove = failFirstDraggedMove
    }

    var events: [InputEvent] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func emit(_ event: InputEvent) throws {
        lock.lock()
        if failFirstDraggedMove,
           !hasFailedDraggedMove,
           case .mouseMove(_, let dragButton) = event,
           dragButton != nil
        {
            hasFailedDraggedMove = true
            lock.unlock()
            throw MouseInjectedError.failure
        }
        storage.append(event)
        lock.unlock()

        switch event {
        case let .mouseMove(point, _), let .mouseButton(_, _, point, _):
            pointer.set(point)
        case .scroll, .key, .unicode:
            break
        }
    }
}


private final class LaggingMousePointerState: @unchecked Sendable {
    private let lock = NSLock()
    private var visible: ComputerPoint
    private var pending: ComputerPoint?
    private var staleReadsRemaining: Int
    private let staleReadsAfterMove: Int

    init(start: ComputerPoint, staleReadsAfterMove: Int) {
        self.visible = start
        self.staleReadsRemaining = 0
        self.staleReadsAfterMove = staleReadsAfterMove
    }

    func scheduleMove(to point: ComputerPoint) {
        lock.lock()
        pending = point
        staleReadsRemaining = staleReadsAfterMove
        lock.unlock()
    }

    func read() -> ComputerPoint {
        lock.lock()
        defer { lock.unlock() }
        guard let pending else { return visible }
        if staleReadsRemaining > 0 {
            staleReadsRemaining -= 1
            return visible
        }
        visible = pending
        self.pending = nil
        return visible
    }
}

private struct LaggingMousePointerReader: PointerReading {
    let state: LaggingMousePointerState
    func currentPointerPosition() throws -> ComputerPoint { state.read() }
}

private final class LaggingMouseSink: InputEventSink, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [InputEvent] = []
    private let pointer: LaggingMousePointerState

    init(pointer: LaggingMousePointerState) { self.pointer = pointer }

    var events: [InputEvent] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func emit(_ event: InputEvent) throws {
        lock.lock(); storage.append(event); lock.unlock()
        if case let .mouseMove(point, _) = event {
            pointer.scheduleMove(to: point)
        }
    }
}

private actor CountingMouseSleeper: InputSleeping {
    private var calls = 0
    func sleep(nanoseconds: UInt64) async throws { calls += 1 }
    func callCount() -> Int { calls }
}

private enum MouseInjectedError: Error { case failure }

private struct MousePointerReader: PointerReading {
    let state: MousePointerState
    func currentPointerPosition() throws -> ComputerPoint { state.get() }
}

private struct MouseDisplays: DisplayTopologyReading {
    func activeDisplayBounds() throws -> [ComputerBounds] {
        [ComputerBounds(x: 0, y: 0, width: 1_728, height: 1_117)]
    }
}

private struct MouseImmediateSleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {}
}

private actor MouseFirstSleepGate: InputSleeping {
    private var firstStarted = false
    private var continuation: CheckedContinuation<Void, Never>?

    func sleep(nanoseconds: UInt64) async throws {
        guard !firstStarted else { return }
        firstStarted = true
        await withCheckedContinuation { continuation = $0 }
    }

    func waitUntilFirstSleepBegins() async {
        while !firstStarted { await Task.yield() }
    }

    func releaseFirstSleep() {
        continuation?.resume()
        continuation = nil
    }
}

private actor MouseCancellationSleeper: InputSleeping {
    private var started = false

    func sleep(nanoseconds: UInt64) async throws {
        started = true
        try await Task.sleep(for: .seconds(60))
    }

    func waitUntilSleeping() async {
        while !started { await Task.yield() }
    }
}

private struct MouseHarness {
    let pointer: MousePointerState
    let sink: MouseRecordingSink
    let controller: ComputerInputController

    init(
        point: ComputerPoint,
        sleeper: any InputSleeping = MouseImmediateSleeper(),
        failFirstDraggedMove: Bool = false
    ) {
        let pointer = MousePointerState(point)
        let sink = MouseRecordingSink(pointer: pointer, failFirstDraggedMove: failFirstDraggedMove)
        self.pointer = pointer
        self.sink = sink
        self.controller = ComputerInputController(
            eventSink: sink,
            pointerReader: MousePointerReader(state: pointer),
            displayTopology: MouseDisplays(),
            sleeper: sleeper
        )
    }
}

private struct MousePermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { true }
    func screenCaptureAuthorized() -> Bool { false }
}

private struct MouseWorkspace: WorkspaceReading {
    func runningApplications() -> [WorkspaceApplication] { [] }
    func frontmostApplication() -> WorkspaceApplication? { nil }
}
