import ComputerRuntimeCore
import CoreGraphics
import Foundation

struct ComputerInputController: Sendable {
    private let eventSink: any InputEventSink
    private let pointerReader: any PointerReading
    private let displayTopology: any DisplayTopologyReading
    private let sleeper: any InputSleeping
    private let lane: PhysicalActionLane

    init(
        eventSink: any InputEventSink,
        pointerReader: any PointerReading,
        displayTopology: any DisplayTopologyReading,
        sleeper: any InputSleeping,
        lane: PhysicalActionLane = PhysicalActionLane()
    ) {
        self.eventSink = eventSink
        self.pointerReader = pointerReader
        self.displayTopology = displayTopology
        self.sleeper = sleeper
        self.lane = lane
    }

    func pointerPosition() throws -> ComputerPoint {
        let point = try pointerReader.currentPointerPosition()
        guard point.x.isFinite, point.y.isFinite else {
            throw ComputerInputError.unavailable
        }
        return point
    }

    func moveMouse(
        to target: ComputerPoint,
        mode: PointerMotionMode = .fast
    ) async throws -> ComputerActionResult {
        await lane.acquire()
        do {
            try Task.checkCancellation()
            try validate(target: target)
            let start = try pointerPosition()
            let samples = try PointerTrajectory.samples(from: start, to: target, mode: mode)

            var previousOffset: UInt64 = 0
            for sample in samples.dropFirst() {
                try Task.checkCancellation()
                let delay = sample.offsetNanoseconds - previousOffset
                if delay > 0 {
                    try await sleeper.sleep(nanoseconds: delay)
                }
                try Task.checkCancellation()
                try eventSink.emit(.mouseMove(point: sample.point, dragButton: nil))
                previousOffset = sample.offsetNanoseconds
            }

            await lane.release()
            return ComputerActionResult(state: "completed", pointer: target)
        } catch {
            await lane.release()
            throw error
        }
    }

    private func validate(target: ComputerPoint) throws {
        guard target.x.isFinite, target.y.isFinite else {
            throw ComputerInputError.targetOutOfBounds
        }
        let displays = try displayTopology.activeDisplayBounds()
        let point = CGPoint(x: target.x, y: target.y)
        let insideDisplay = displays.contains { bounds in
            guard bounds.x.isFinite,
                  bounds.y.isFinite,
                  bounds.width.isFinite,
                  bounds.height.isFinite,
                  bounds.width > 0,
                  bounds.height > 0
            else {
                return false
            }
            return CGRect(
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height
            ).contains(point)
        }
        guard insideDisplay else {
            throw ComputerInputError.targetOutOfBounds
        }
    }
}
