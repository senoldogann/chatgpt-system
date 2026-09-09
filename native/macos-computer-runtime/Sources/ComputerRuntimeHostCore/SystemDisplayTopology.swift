import ComputerRuntimeCore
import CoreGraphics
import Foundation

struct SystemDisplayTopology: DisplayTopologyReading, PointerReading {
    private static let maxDisplays = 32

    func activeDisplayBounds() throws -> [ComputerBounds] {
        var displayIDs = [CGDirectDisplayID](repeating: 0, count: Self.maxDisplays)
        var count: UInt32 = 0
        let error = displayIDs.withUnsafeMutableBufferPointer { buffer in
            CGGetActiveDisplayList(UInt32(buffer.count), buffer.baseAddress, &count)
        }
        guard error == .success else {
            throw ComputerInputError.unavailable
        }

        return displayIDs.prefix(Int(count)).compactMap { displayID in
            let bounds = CGDisplayBounds(displayID)
            guard bounds.origin.x.isFinite,
                  bounds.origin.y.isFinite,
                  bounds.width.isFinite,
                  bounds.height.isFinite,
                  bounds.width > 0,
                  bounds.height > 0
            else {
                return nil
            }
            return ComputerBounds(
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.width,
                height: bounds.height
            )
        }
    }

    func currentPointerPosition() throws -> ComputerPoint {
        guard let event = CGEvent(source: nil) else {
            throw ComputerInputError.unavailable
        }
        let location = event.location
        guard location.x.isFinite, location.y.isFinite else {
            throw ComputerInputError.unavailable
        }
        return ComputerPoint(x: location.x, y: location.y)
    }
}
