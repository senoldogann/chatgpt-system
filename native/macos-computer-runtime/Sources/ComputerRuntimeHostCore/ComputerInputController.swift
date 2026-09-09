import ComputerRuntimeCore
import CoreGraphics
import Foundation

struct ComputerInputController: Sendable {
    private static let clickTolerancePixels = 2.0
    private static let interClickPauseNanoseconds: UInt64 = 60_000_000
    private static let maxScrollDelta: Int32 = 10_000
    private static let maxUnicodeChunkUTF16Units = 20
    private static let mouseReleaseOrder: [ComputerMouseButton] = [.left, .right, .middle]

    private let eventSink: any InputEventSink
    private let pointerReader: any PointerReading
    private let displayTopology: any DisplayTopologyReading
    private let sleeper: any InputSleeping
    private let lane: PhysicalActionLane
    private let heldInputs: HeldInputStore

    init(
        eventSink: any InputEventSink,
        pointerReader: any PointerReading,
        displayTopology: any DisplayTopologyReading,
        sleeper: any InputSleeping,
        lane: PhysicalActionLane = PhysicalActionLane(),
        heldInputs: HeldInputStore = HeldInputStore()
    ) {
        self.eventSink = eventSink
        self.pointerReader = pointerReader
        self.displayTopology = displayTopology
        self.sleeper = sleeper
        self.lane = lane
        self.heldInputs = heldInputs
    }

    func pointerPosition() throws -> ComputerPoint {
        let point = try pointerReader.currentPointerPosition()
        guard point.x.isFinite, point.y.isFinite else {
            throw ComputerInputError.unavailable
        }
        return point
    }

    func heldInputState() async -> HeldInputState {
        await heldInputs.snapshot()
    }

    func moveMouse(
        to target: ComputerPoint,
        mode: PointerMotionMode = .fast
    ) async throws -> ComputerActionResult {
        await lane.acquire()
        do {
            let result = try await moveMouseWithinLane(to: target, mode: mode, dragButton: nil)
            await lane.release()
            return result
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func click(
        at target: ComputerPoint,
        button: ComputerMouseButton,
        mode: PointerMotionMode
    ) async throws -> ComputerActionResult {
        await lane.acquire()
        do {
            _ = try await moveMouseWithinLane(to: target, mode: mode, dragButton: nil)
            try verifyPointerNear(target)
            try await emitMouseDownWithinLane(button, point: target, clickCount: 1)
            try await emitMouseUpWithinLane(button, point: target, clickCount: 1)
            await lane.release()
            return ComputerActionResult(state: "completed", pointer: target)
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func doubleClick(
        at target: ComputerPoint,
        button: ComputerMouseButton,
        mode: PointerMotionMode
    ) async throws -> ComputerActionResult {
        await lane.acquire()
        do {
            _ = try await moveMouseWithinLane(to: target, mode: mode, dragButton: nil)
            try verifyPointerNear(target)
            try await emitMouseDownWithinLane(button, point: target, clickCount: 1)
            try await emitMouseUpWithinLane(button, point: target, clickCount: 1)
            try await sleeper.sleep(nanoseconds: Self.interClickPauseNanoseconds)
            try Task.checkCancellation()
            try await emitMouseDownWithinLane(button, point: target, clickCount: 2)
            try await emitMouseUpWithinLane(button, point: target, clickCount: 2)
            await lane.release()
            return ComputerActionResult(state: "completed", pointer: target)
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func mouseDown(_ button: ComputerMouseButton) async throws -> ComputerActionResult {
        await lane.acquire()
        do {
            let point = try pointerPosition()
            try await emitMouseDownWithinLane(button, point: point, clickCount: 1)
            await lane.release()
            return ComputerActionResult(state: "completed", pointer: point)
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func mouseUp(_ button: ComputerMouseButton) async throws -> ComputerActionResult {
        await lane.acquire()
        do {
            let point = try pointerPosition()
            try await emitMouseUpWithinLane(button, point: point, clickCount: 1)
            await lane.release()
            return ComputerActionResult(state: "completed", pointer: point)
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func drag(
        from start: ComputerPoint,
        to target: ComputerPoint,
        button: ComputerMouseButton,
        mode: PointerMotionMode
    ) async throws -> ComputerActionResult {
        await lane.acquire()
        do {
            _ = try await moveMouseWithinLane(to: start, mode: mode, dragButton: nil)
            try verifyPointerNear(start)
            try await emitMouseDownWithinLane(button, point: start, clickCount: 1)
            _ = try await moveMouseWithinLane(to: target, mode: mode, dragButton: button)
            try await emitMouseUpWithinLane(button, point: target, clickCount: 1)
            await lane.release()
            return ComputerActionResult(state: "completed", pointer: target)
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func scroll(
        vertical: Int32,
        horizontal: Int32,
        at point: ComputerPoint?,
        mode: PointerMotionMode
    ) async throws -> ComputerActionResult {
        guard abs(Int64(vertical)) <= Int64(Self.maxScrollDelta),
              abs(Int64(horizontal)) <= Int64(Self.maxScrollDelta)
        else {
            throw ComputerInputError.invalidInput
        }

        await lane.acquire()
        do {
            if let point {
                _ = try await moveMouseWithinLane(to: point, mode: mode, dragButton: nil)
            }
            try Task.checkCancellation()
            if vertical != 0 || horizontal != 0 {
                try eventSink.emit(.scroll(vertical: vertical, horizontal: horizontal))
            }
            let current = try pointerPosition()
            await lane.release()
            return ComputerActionResult(state: "completed", pointer: current)
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func pressKey(
        named name: String,
        modifiers: Set<ComputerKeyModifier>,
        focusGuard: any InputFocusGuard
    ) async throws -> ComputerActionResult {
        guard let keyCode = KeyMapping.keyCode(for: name) else {
            throw ComputerInputError.invalidInput
        }

        await lane.acquire()
        do {
            try Task.checkCancellation()
            try await focusGuard.verifyExpectedFrontmost()
            var activeModifiers = (await heldInputs.snapshot()).modifiers

            for modifier in KeyMapping.modifierDownOrder where modifiers.contains(modifier) && !activeModifiers.contains(modifier) {
                try Task.checkCancellation()
                try await focusGuard.verifyExpectedFrontmost()
                let nextModifiers = activeModifiers.union([modifier])
                try eventSink.emit(.key(
                    keyCode: KeyMapping.modifierKeyCode(for: modifier),
                    down: true,
                    modifiers: nextModifiers
                ))
                await heldInputs.insertModifier(modifier)
                activeModifiers = nextModifiers
            }

            try Task.checkCancellation()
            try await focusGuard.verifyExpectedFrontmost()
            try eventSink.emit(.key(keyCode: keyCode, down: true, modifiers: activeModifiers))
            await heldInputs.insertKeyCode(keyCode)

            try Task.checkCancellation()
            try await focusGuard.verifyExpectedFrontmost()
            try eventSink.emit(.key(keyCode: keyCode, down: false, modifiers: activeModifiers))
            await heldInputs.removeKeyCode(keyCode)

            for modifier in KeyMapping.modifierReleaseOrder where modifiers.contains(modifier) && activeModifiers.contains(modifier) {
                try Task.checkCancellation()
                try await focusGuard.verifyExpectedFrontmost()
                let nextModifiers = activeModifiers.subtracting([modifier])
                try eventSink.emit(.key(
                    keyCode: KeyMapping.modifierKeyCode(for: modifier),
                    down: false,
                    modifiers: nextModifiers
                ))
                await heldInputs.removeModifier(modifier)
                activeModifiers = nextModifiers
            }

            await lane.release()
            return ComputerActionResult(state: "completed")
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func typeText(
        _ text: String,
        focusGuard: any InputFocusGuard
    ) async throws -> ComputerActionResult {
        await lane.acquire()
        do {
            try Task.checkCancellation()
            try await focusGuard.verifyExpectedFrontmost()
            for chunk in Self.unicodeChunks(text) {
                try Task.checkCancellation()
                try await focusGuard.verifyExpectedFrontmost()
                try eventSink.emit(.unicode(chunk))
            }
            await lane.release()
            return ComputerActionResult(state: "completed")
        } catch {
            try? await releaseAllInputsWithinLane()
            await lane.release()
            throw error
        }
    }

    func releaseAllInputs() async throws {
        await lane.acquire()
        do {
            try await releaseAllInputsWithinLane()
            await lane.release()
        } catch {
            await lane.release()
            throw error
        }
    }

    private func moveMouseWithinLane(
        to target: ComputerPoint,
        mode: PointerMotionMode,
        dragButton: ComputerMouseButton?
    ) async throws -> ComputerActionResult {
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
            try eventSink.emit(.mouseMove(point: sample.point, dragButton: dragButton))
            previousOffset = sample.offsetNanoseconds
        }

        return ComputerActionResult(state: "completed", pointer: target)
    }

    private func emitMouseDownWithinLane(
        _ button: ComputerMouseButton,
        point: ComputerPoint,
        clickCount: Int
    ) async throws {
        try Task.checkCancellation()
        try eventSink.emit(.mouseButton(button: button, down: true, point: point, clickCount: clickCount))
        await heldInputs.insertMouseButton(button)
    }

    private func emitMouseUpWithinLane(
        _ button: ComputerMouseButton,
        point: ComputerPoint,
        clickCount: Int
    ) async throws {
        try eventSink.emit(.mouseButton(button: button, down: false, point: point, clickCount: clickCount))
        await heldInputs.removeMouseButton(button)
    }

    private func releaseAllInputsWithinLane() async throws {
        var firstError: Error?
        var snapshot = await heldInputs.snapshot()
        var activeModifiers = snapshot.modifiers

        for keyCode in snapshot.keyCodes.sorted() {
            do {
                try eventSink.emit(.key(keyCode: keyCode, down: false, modifiers: activeModifiers))
                await heldInputs.removeKeyCode(keyCode)
            } catch {
                if firstError == nil { firstError = error }
            }
        }

        for modifier in KeyMapping.modifierReleaseOrder where activeModifiers.contains(modifier) {
            let nextModifiers = activeModifiers.subtracting([modifier])
            do {
                try eventSink.emit(.key(
                    keyCode: KeyMapping.modifierKeyCode(for: modifier),
                    down: false,
                    modifiers: nextModifiers
                ))
                await heldInputs.removeModifier(modifier)
                activeModifiers = nextModifiers
            } catch {
                if firstError == nil { firstError = error }
            }
        }

        snapshot = await heldInputs.snapshot()
        if !snapshot.mouseButtons.isEmpty {
            do {
                let point = try pointerPosition()
                for button in Self.mouseReleaseOrder where snapshot.mouseButtons.contains(button) {
                    do {
                        try eventSink.emit(.mouseButton(button: button, down: false, point: point, clickCount: 1))
                        await heldInputs.removeMouseButton(button)
                    } catch {
                        if firstError == nil { firstError = error }
                    }
                }
            } catch {
                if firstError == nil { firstError = error }
            }
        }

        if let firstError { throw firstError }
    }

    private static func unicodeChunks(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        var chunks: [String] = []
        var current = ""
        var currentUTF16Units = 0

        for scalar in text.unicodeScalars {
            let piece = String(scalar)
            let pieceUnits = piece.utf16.count
            if currentUTF16Units + pieceUnits > Self.maxUnicodeChunkUTF16Units, !current.isEmpty {
                chunks.append(current)
                current = ""
                currentUTF16Units = 0
            }
            current.append(contentsOf: piece)
            currentUTF16Units += pieceUnits
        }

        if !current.isEmpty {
            chunks.append(current)
        }
        return chunks
    }

    private func verifyPointerNear(_ target: ComputerPoint) throws {
        let current = try pointerPosition()
        let distance = hypot(current.x - target.x, current.y - target.y)
        guard distance <= Self.clickTolerancePixels else {
            throw ComputerInputError.unavailable
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
