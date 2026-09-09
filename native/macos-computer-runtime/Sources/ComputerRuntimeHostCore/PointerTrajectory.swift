import ComputerRuntimeCore
import Foundation

struct PointerTrajectorySample: Equatable, Sendable {
    let point: ComputerPoint
    let offsetNanoseconds: UInt64
}

enum PointerTrajectory {
    static func samples(
        from start: ComputerPoint,
        to target: ComputerPoint,
        mode: PointerMotionMode
    ) throws -> [PointerTrajectorySample] {
        guard start.x.isFinite, start.y.isFinite, target.x.isFinite, target.y.isFinite else {
            throw ComputerInputError.unavailable
        }

        if mode == .instant {
            return [
                PointerTrajectorySample(point: start, offsetNanoseconds: 0),
                PointerTrajectorySample(point: target, offsetNanoseconds: 0),
            ]
        }

        let dx = target.x - start.x
        let dy = target.y - start.y
        let distance = hypot(dx, dy)
        let fastMilliseconds: Double
        switch distance {
        case ...40:
            fastMilliseconds = 70
        case ...200:
            fastMilliseconds = 100
        case ...700:
            fastMilliseconds = 150
        default:
            fastMilliseconds = 210
        }

        let requestedMilliseconds = mode == .natural
            ? (fastMilliseconds * 1.4).rounded()
            : fastMilliseconds
        let durationMilliseconds = min(350, max(70, requestedMilliseconds))
        let durationNanoseconds = UInt64(durationMilliseconds * 1_000_000)
        let sampleStepNanoseconds: UInt64 = 8_000_000

        var result = [PointerTrajectorySample(point: start, offsetNanoseconds: 0)]
        var offset = sampleStepNanoseconds
        while offset < durationNanoseconds {
            let t = Double(offset) / Double(durationNanoseconds)
            let eased = t * t * (3 - 2 * t)
            result.append(
                PointerTrajectorySample(
                    point: ComputerPoint(
                        x: start.x + (dx * eased),
                        y: start.y + (dy * eased)
                    ),
                    offsetNanoseconds: offset
                )
            )
            offset += sampleStepNanoseconds
        }
        result.append(PointerTrajectorySample(point: target, offsetNanoseconds: durationNanoseconds))
        return result
    }
}
