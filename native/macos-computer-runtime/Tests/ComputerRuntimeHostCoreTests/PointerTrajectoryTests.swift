import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class PointerTrajectoryTests: XCTestCase {
    func testTrajectoryHasExactStartAndEnd() throws {
        let start = ComputerPoint(x: 10, y: 20)
        let end = ComputerPoint(x: 310, y: 420)

        let samples = try PointerTrajectory.samples(from: start, to: end, mode: .fast)

        XCTAssertEqual(samples.first?.point, start)
        XCTAssertEqual(samples.last?.point, end)
        XCTAssertGreaterThan(samples.count, 2)
    }

    func testFastDurationUsesDistanceBands() throws {
        XCTAssertEqual(lastOffsetMs(distance: 20, mode: .fast), 70)
        XCTAssertEqual(lastOffsetMs(distance: 100, mode: .fast), 100)
        XCTAssertEqual(lastOffsetMs(distance: 500, mode: .fast), 150)
        XCTAssertEqual(lastOffsetMs(distance: 1_000, mode: .fast), 210)
    }

    func testTrajectoryDurationIsClampedTo350Milliseconds() throws {
        let samples = try PointerTrajectory.samples(
            from: ComputerPoint(x: 0, y: 0),
            to: ComputerPoint(x: 1_000_000, y: 0),
            mode: .natural
        )

        XCTAssertLessThanOrEqual(try XCTUnwrap(samples.last).offsetNanoseconds, 350_000_000)
    }

    func testInstantHasZeroDurationAndExactEndpoint() throws {
        let start = ComputerPoint(x: 5, y: 5)
        let end = ComputerPoint(x: 50, y: 75)

        let samples = try PointerTrajectory.samples(from: start, to: end, mode: .instant)

        XCTAssertEqual(samples.map(\.point), [start, end])
        XCTAssertEqual(samples.map(\.offsetNanoseconds), [0, 0])
    }

    func testNaturalIsSlowerThanFastWithoutRandomJitter() throws {
        let start = ComputerPoint(x: 0, y: 0)
        let end = ComputerPoint(x: 300, y: 400)

        let fast = try PointerTrajectory.samples(from: start, to: end, mode: .fast)
        let naturalA = try PointerTrajectory.samples(from: start, to: end, mode: .natural)
        let naturalB = try PointerTrajectory.samples(from: start, to: end, mode: .natural)

        XCTAssertGreaterThan(try XCTUnwrap(naturalA.last).offsetNanoseconds, try XCTUnwrap(fast.last).offsetNanoseconds)
        XCTAssertEqual(naturalA, naturalB)
    }

    private func lastOffsetMs(distance: Double, mode: PointerMotionMode) -> UInt64 {
        let samples = try! PointerTrajectory.samples(
            from: ComputerPoint(x: 0, y: 0),
            to: ComputerPoint(x: distance, y: 0),
            mode: mode
        )
        return samples.last!.offsetNanoseconds / 1_000_000
    }
}
