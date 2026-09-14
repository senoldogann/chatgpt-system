import AppKit
import ComputerRuntimeCore
import CoreGraphics
import Foundation
import ScreenCaptureKit

enum InteractiveDisplaySelection {
    static func select(
        availableDisplayIDs: [CGDirectDisplayID],
        focusedDisplayID: CGDirectDisplayID?,
        mainDisplayID: CGDirectDisplayID
    ) throws -> CGDirectDisplayID {
        if let focusedDisplayID, availableDisplayIDs.contains(focusedDisplayID) {
            return focusedDisplayID
        }
        if availableDisplayIDs.contains(mainDisplayID) {
            return mainDisplayID
        }
        guard let fallback = availableDisplayIDs.first else {
            throw ScreenshotCaptureError.unavailable
        }
        return fallback
    }
}

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

enum WindowCaptureGeometry {
    static func cropRect(
        windowBounds: ComputerBounds,
        captureBounds: ComputerBounds,
        imageWidth: Int,
        imageHeight: Int
    ) -> CGRect? {
        guard imageWidth > 0,
              imageHeight > 0,
              windowBounds.x.isFinite,
              windowBounds.y.isFinite,
              windowBounds.width.isFinite,
              windowBounds.height.isFinite,
              captureBounds.x.isFinite,
              captureBounds.y.isFinite,
              captureBounds.width.isFinite,
              captureBounds.height.isFinite,
              windowBounds.width > 0,
              windowBounds.height > 0,
              captureBounds.width > 0,
              captureBounds.height > 0,
              windowBounds.x >= captureBounds.x,
              windowBounds.y >= captureBounds.y,
              windowBounds.x + windowBounds.width <= captureBounds.x + captureBounds.width,
              windowBounds.y + windowBounds.height <= captureBounds.y + captureBounds.height
        else {
            return nil
        }

        let scaleX = Double(imageWidth) / captureBounds.width
        let scaleY = Double(imageHeight) / captureBounds.height
        let rect = CGRect(
            x: (windowBounds.x - captureBounds.x) * scaleX,
            y: (windowBounds.y - captureBounds.y) * scaleY,
            width: windowBounds.width * scaleX,
            height: windowBounds.height * scaleY
        ).integral
        guard rect.minX >= 0,
              rect.minY >= 0,
              rect.maxX <= Double(imageWidth),
              rect.maxY <= Double(imageHeight),
              rect.width > 0,
              rect.height > 0
        else {
            return nil
        }
        return rect
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

        let focusedDisplayID = focusedDisplay.focusedDisplayID()
        let mainDisplayID = CGMainDisplayID()
        let capture = try await captureImage { displays in
            let selected = try InteractiveDisplaySelection.select(
                availableDisplayIDs: displays.map(\.displayID),
                focusedDisplayID: focusedDisplayID,
                mainDisplayID: mainDisplayID
            )
            return displays.first(where: { $0.displayID == selected })
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

        let scaleX = Double(capture.image.width) / capture.screenBounds.width
        let scaleY = Double(capture.image.height) / capture.screenBounds.height
        guard scaleX.isFinite, scaleY.isFinite, scaleX > 0, scaleY > 0 else {
            throw ScreenshotCaptureError.unavailable
        }
        return ComputerScreenshot(
            pngBase64: png.base64EncodedString(),
            width: capture.image.width,
            height: capture.image.height,
            captureKind: .display,
            screenBounds: capture.screenBounds,
            scaleX: scaleX,
            scaleY: scaleY
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

    func captureWindowImage(bounds: ComputerBounds) async throws -> ScreenImageCapture {
        let displayCapture = try await captureFocusedDisplayImage()
        guard let cropRect = WindowCaptureGeometry.cropRect(
            windowBounds: bounds,
            captureBounds: displayCapture.screenBounds,
            imageWidth: displayCapture.image.width,
            imageHeight: displayCapture.image.height
        ),
        let cropped = displayCapture.image.cropping(to: cropRect)
        else {
            throw ScreenshotCaptureError.unavailable
        }
        return ScreenImageCapture(image: cropped, screenBounds: bounds)
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
