import Darwin
import Foundation

struct SystemPointerSleeper: InputSleeping {
    private static let preciseThresholdNanoseconds: UInt64 = 10_000_000

    static func usesPrecisePacing(for nanoseconds: UInt64) -> Bool {
        nanoseconds > 0 && nanoseconds <= preciseThresholdNanoseconds
    }

    func sleep(nanoseconds: UInt64) async throws {
        guard nanoseconds > 0 else { return }
        try Task.checkCancellation()

        guard Self.usesPrecisePacing(for: nanoseconds) else {
            try await Task.sleep(nanoseconds: nanoseconds)
            return
        }

        var timebase = mach_timebase_info_data_t()
        guard mach_timebase_info(&timebase) == KERN_SUCCESS,
              timebase.numer > 0,
              timebase.denom > 0
        else {
            throw ComputerInputError.unavailable
        }

        let ticksDouble = (Double(nanoseconds) * Double(timebase.denom)) / Double(timebase.numer)
        let ticks = UInt64(ticksDouble.rounded(.up))
        let started = mach_absolute_time()
        let (deadline, overflow) = started.addingReportingOverflow(ticks)
        guard !overflow else {
            throw ComputerInputError.unavailable
        }

        var spins: UInt32 = 0
        while mach_absolute_time() < deadline {
            spins &+= 1
            if spins & 0x3FF == 0 {
                try Task.checkCancellation()
            }
        }
        try Task.checkCancellation()
    }
}
