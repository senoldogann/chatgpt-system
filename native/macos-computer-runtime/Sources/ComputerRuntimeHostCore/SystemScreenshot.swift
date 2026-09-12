import AppKit
import ComputerRuntimeCore
import CoreGraphics
import Foundation
import ScreenCaptureKit

enum FocusedDisplaySelection {
    static func select(
        availableDisplayIDs: [CGDirectDisplayID],
        focusedDisplayID: CGDirectDisplayID?
    ) throws -> CGDirectDisplayID {
        guard let focusedDisplayID else {
            throw ScreenshotCaptureError.unavailable
        }
        guard availableDisplayIDs.contains(focusedDisplayID) else {
            throw ScreenshotCaptureError.unavailable
        }
        return focusedDisplayID
    }
}

struct MainScreenFocusedDisplayReader: FocusedDisplayReading {
    func focusedDisplayID() -> CGDirectDisplayID? {
        // NSScreen.main is the screen holding the key window, not the primary display.
        guard let number = NSScreen.main?.deviceDescription[
            NSDeviceDescriptionKey("NSScreenNumber")
        ] as? NSNumber else {
            return nil
        }
        return CGDirectDisplayID(number.uint32Value)
    }
}

public struct SystemScreenshotCapturer: ScreenshotCapturing, ScreenImageCapturing {
    private let focusedDisplay: any FocusedDisplayReading

    public init() {
        self.focusedDisplay = MainScreenFocusedDisplayReader()
    }

    init(focusedDisplay: any FocusedDisplayReading) {
        self.focusedDisplay = focusedDisplay
    }

    public func captureMainDisplay(maxBytes: Int) async throws -> ComputerScreenshot {
        guard maxBytes > 0 else {
            throw ScreenshotCaptureError.outputLimit
        }

        let capture = try await captureImage { displays in
            displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? displays.first
        }
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

    func captureFocusedDisplayImage() async throws -> ScreenImageCapture {
        let focusedDisplayID = focusedDisplay.focusedDisplayID()
        return try await captureImage { displays in
            let selected = try FocusedDisplaySelection.select(
                availableDisplayIDs: displays.map(\.displayID),
                focusedDisplayID: focusedDisplayID
            )
            return displays.first(where: { $0.displayID == selected })
        }
    }

    private func captureImage(
        selecting select: ([SCDisplay]) throws -> SCDisplay?
    ) async throws -> ScreenImageCapture {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = try select(content.displays) else {
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
