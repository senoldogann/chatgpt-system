import AppKit
import ComputerRuntimeCore
import CoreGraphics
import CryptoKit
import Foundation
import ScreenCaptureKit

struct ResolvedScreenRegion: Equatable, Sendable {
    let displayIndex: Int
    let localBounds: ComputerBounds
}

struct SystemScreenRegionDigester: ScreenRegionDigesting {
    func digest(bounds: ComputerBounds) async throws -> String {
        let displayIDs = try activeDisplayIDs()
        let displayBounds = displayIDs.map { id -> ComputerBounds in
            let frame = CGDisplayBounds(id)
            return ComputerBounds(
                x: frame.origin.x,
                y: frame.origin.y,
                width: frame.size.width,
                height: frame.size.height
            )
        }
        guard let resolved = Self.resolveRegion(bounds: bounds, activeDisplays: displayBounds),
              resolved.displayIndex < displayIDs.count
        else {
            throw ComputerVerificationError.invalidRegion
        }

        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        let displayID = displayIDs[resolved.displayIndex]
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw ComputerVerificationError.unavailable
        }

        let filter = SCContentFilter(
            display: display,
            excludingApplications: [],
            exceptingWindows: []
        )
        let configuration = SCStreamConfiguration()
        configuration.sourceRect = CGRect(
            x: resolved.localBounds.x,
            y: resolved.localBounds.y,
            width: resolved.localBounds.width,
            height: resolved.localBounds.height
        )
        configuration.width = max(1, Int(resolved.localBounds.width.rounded()))
        configuration.height = max(1, Int(resolved.localBounds.height.rounded()))
        configuration.showsCursor = false

        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        let representation = NSBitmapImageRep(cgImage: image)
        guard let png = representation.representation(using: .png, properties: [:]), !png.isEmpty else {
            throw ComputerVerificationError.unavailable
        }

        let digest = SHA256.hash(data: png)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func resolveRegion(
        bounds: ComputerBounds,
        activeDisplays: [ComputerBounds]
    ) -> ResolvedScreenRegion? {
        guard bounds.x.isFinite,
              bounds.y.isFinite,
              bounds.width.isFinite,
              bounds.height.isFinite,
              bounds.width > 0,
              bounds.height > 0
        else {
            return nil
        }

        let region = CGRect(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height)
        for (index, display) in activeDisplays.enumerated() {
            guard display.x.isFinite,
                  display.y.isFinite,
                  display.width.isFinite,
                  display.height.isFinite,
                  display.width > 0,
                  display.height > 0
            else {
                continue
            }
            let displayRect = CGRect(
                x: display.x,
                y: display.y,
                width: display.width,
                height: display.height
            )
            guard displayRect.contains(region) else { continue }
            return ResolvedScreenRegion(
                displayIndex: index,
                localBounds: ComputerBounds(
                    x: bounds.x - display.x,
                    y: bounds.y - display.y,
                    width: bounds.width,
                    height: bounds.height
                )
            )
        }
        return nil
    }

    private func activeDisplayIDs() throws -> [CGDirectDisplayID] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else {
            throw ComputerVerificationError.unavailable
        }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &ids, &count) == .success else {
            throw ComputerVerificationError.unavailable
        }
        return Array(ids.prefix(Int(count)))
    }
}
