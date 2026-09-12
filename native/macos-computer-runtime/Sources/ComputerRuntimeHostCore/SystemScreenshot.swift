import AppKit
import ComputerRuntimeCore
import CoreGraphics
import Foundation
import ScreenCaptureKit

public struct SystemScreenshotCapturer: ScreenshotCapturing, ScreenImageCapturing {
    public init() {}

    public func captureMainDisplay(maxBytes: Int) async throws -> ComputerScreenshot {
        guard maxBytes > 0 else {
            throw ScreenshotCaptureError.outputLimit
        }

        let capture = try await captureMainDisplayImage()
        let representation = NSBitmapImageRep(cgImage: capture.image)
        guard let png = representation.representation(using: .png, properties: [:]),
              !png.isEmpty
        else {
            throw ScreenshotCaptureError.unavailable
        }
        guard png.count <= maxBytes else {
            throw ScreenshotCaptureError.outputLimit
        }

        return ComputerScreenshot(
            pngBase64: png.base64EncodedString(),
            width: capture.image.width,
            height: capture.image.height
        )
    }

    func captureMainDisplayImage() async throws -> ScreenImageCapture {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() })
            ?? content.displays.first
        else {
            throw ScreenshotCaptureError.unavailable
        }

        let displayBounds = CGDisplayBounds(display.displayID)
        guard displayBounds.origin.x.isFinite,
              displayBounds.origin.y.isFinite,
              displayBounds.width.isFinite,
              displayBounds.height.isFinite,
              displayBounds.width > 0,
              displayBounds.height > 0
        else {
            throw ScreenshotCaptureError.unavailable
        }

        let filter = SCContentFilter(
            display: display,
            excludingApplications: [],
            exceptingWindows: []
        )
        let configuration = SCStreamConfiguration()
        configuration.width = display.width
        configuration.height = display.height
        configuration.showsCursor = true

        let image = try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
        return ScreenImageCapture(
            image: image,
            screenBounds: ComputerBounds(
                x: displayBounds.origin.x,
                y: displayBounds.origin.y,
                width: displayBounds.width,
                height: displayBounds.height
            )
        )
    }
}
