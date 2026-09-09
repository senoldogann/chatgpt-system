import Foundation
import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class InputControllerTests: XCTestCase {
    func testPointerPositionIsReadOnlyAndReturnsCurrentPoint() async throws {
        let sink = RecordingInputSink()
        let controller = makeController(
            sink: sink,
            pointer: ComputerPoint(x: 123, y: 456)
        )

        let point = try controller.pointerPosition()

        XCTAssertEqual(point, ComputerPoint(x: 123, y: 456))
        XCTAssertEqual(sink.events, [])
    }

    func testMoveRejectsPointOutsideEveryActiveDisplayWithoutEmitting() async {
        let sink = RecordingInputSink()
        let controller = makeController(
            sink: sink,
            pointer: ComputerPoint(x: 100, y: 100),
            displays: fixtureDisplays
        )

        do {
            _ = try await controller.moveMouse(to: ComputerPoint(x: 2_000, y: 2_000), mode: .instant)
            XCTFail("Expected targetOutOfBounds")
        } catch {
            XCTAssertEqual(error as? ComputerInputError, .targetOutOfBounds)
        }
        XCTAssertEqual(sink.events, [])
    }

    func testMoveAllowsNegativeCoordinatesWhenInsideSecondDisplay() async throws {
        let sink = RecordingInputSink()
        let controller = makeController(
            sink: sink,
            pointer: ComputerPoint(x: 10, y: 10),
            displays: fixtureDisplays
        )
        let target = ComputerPoint(x: -900, y: 400)

        let result = try await controller.moveMouse(to: target, mode: .instant)

        XCTAssertEqual(result.state, "completed")
        XCTAssertEqual(result.pointer, target)
        XCTAssertEqual(sink.events.last, .mouseMove(point: target, dragButton: nil))
    }

    func testMoveEmitsExactEndpoint() async throws {
        let sink = RecordingInputSink()
        let controller = makeController(
            sink: sink,
            pointer: ComputerPoint(x: 0, y: 0),
            displays: fixtureDisplays
        )
        let target = ComputerPoint(x: 500, y: 300)

        _ = try await controller.moveMouse(to: target, mode: .fast)

        XCTAssertEqual(sink.events.last, .mouseMove(point: target, dragButton: nil))
    }

    func testConcurrentMovesDoNotInterleaveAcrossSleeps() async throws {
        let sink = RecordingInputSink()
        let sleeper = FirstSleepGate()
        let controller = makeController(
            sink: sink,
            pointer: ComputerPoint(x: 0, y: 0),
            displays: fixtureDisplays,
            sleeper: sleeper
        )

        let first = Task {
            try await controller.moveMouse(to: ComputerPoint(x: 100, y: 0), mode: .fast)
        }
        await sleeper.waitUntilFirstSleepBegins()
        XCTAssertEqual(sink.events.count, 0)

        let second = Task {
            try await controller.moveMouse(to: ComputerPoint(x: 200, y: 0), mode: .fast)
        }
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(
            sink.events.count,
            0,
            "Second action must not emit while the first action owns the physical lane"
        )

        await sleeper.releaseFirstSleep()
        _ = try await first.value
        _ = try await second.value
        XCTAssertEqual(sink.events.last, .mouseMove(point: ComputerPoint(x: 200, y: 0), dragButton: nil))
    }

    func testRuntimeOwnedTagConstantIsSingleStableValue() {
        XCTAssertEqual(RuntimeOwnedEventTag.value, 0x4352_5632_494E_5054)
    }

    func testSystemPointerSleeperUsesPrecisePacingOnlyForTrajectoryScaleDelays() {
        XCTAssertFalse(SystemPointerSleeper.usesPrecisePacing(for: 0))
        XCTAssertTrue(SystemPointerSleeper.usesPrecisePacing(for: 8_000_000))
        XCTAssertTrue(SystemPointerSleeper.usesPrecisePacing(for: 10_000_000))
        XCTAssertFalse(SystemPointerSleeper.usesPrecisePacing(for: 10_000_001))
    }
}

private let fixtureDisplays = [
    ComputerBounds(x: 0, y: 0, width: 1_728, height: 1_117),
    ComputerBounds(x: -1_920, y: 0, width: 1_920, height: 1_080),
]

private func makeController(
    sink: RecordingInputSink,
    pointer: ComputerPoint,
    displays: [ComputerBounds] = fixtureDisplays,
    sleeper: any InputSleeping = ImmediateInputSleeper()
) -> ComputerInputController {
    ComputerInputController(
        eventSink: sink,
        pointerReader: FixedPointerReader(point: pointer),
        displayTopology: FixedDisplayTopology(bounds: displays),
        sleeper: sleeper
    )
}

private final class RecordingInputSink: InputEventSink, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [InputEvent] = []

    var events: [InputEvent] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func emit(_ event: InputEvent) throws {
        lock.lock()
        storage.append(event)
        lock.unlock()
    }
}

private struct FixedPointerReader: PointerReading {
    let point: ComputerPoint
    func currentPointerPosition() throws -> ComputerPoint { point }
}

private struct FixedDisplayTopology: DisplayTopologyReading {
    let bounds: [ComputerBounds]
    func activeDisplayBounds() throws -> [ComputerBounds] { bounds }
}

private struct ImmediateInputSleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {}
}

private actor FirstSleepGate: InputSleeping {
    private var firstSleepStarted = false
    private var firstContinuation: CheckedContinuation<Void, Never>?

    func sleep(nanoseconds: UInt64) async throws {
        guard !firstSleepStarted else { return }
        firstSleepStarted = true
        await withCheckedContinuation { continuation in
            firstContinuation = continuation
        }
    }

    func waitUntilFirstSleepBegins() async {
        while !firstSleepStarted {
            await Task.yield()
        }
    }

    func releaseFirstSleep() {
        firstContinuation?.resume()
        firstContinuation = nil
    }
}
