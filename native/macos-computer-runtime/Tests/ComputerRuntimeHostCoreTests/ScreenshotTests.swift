import ComputerRuntimeCore
import CoreGraphics
import Foundation
import XCTest
@testable import ComputerRuntimeHostCore

final class ScreenshotTests: XCTestCase {
    func testAuthorizedScreenshotReturnsBase64AndDimensions() async throws {
        let png = Data([0x89, 0x50, 0x4E, 0x47])
        let counter = ScreenshotInvocationCounter()
        let service = makeScreenshotService(
            authorized: true,
            capturer: FakeScreenshotCapturer(
                screenshot: ComputerScreenshot(
                    pngBase64: png.base64EncodedString(),
                    width: 1440,
                    height: 900,
                    captureKind: .display,
                    screenBounds: ComputerBounds(x: -720, y: 40, width: 720, height: 450),
                    scaleX: 0.5,
                    scaleY: 0.5
                ),
                counter: counter
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "screenshot-ok",
            method: "screenshot",
            params: .object([:])
        ))

        XCTAssertTrue(response.ok)
        let screenshot = try decodeScreenshotResult(from: response)
        XCTAssertEqual(Data(base64Encoded: screenshot.pngBase64), png)
        XCTAssertEqual(screenshot.width, 1440)
        XCTAssertEqual(screenshot.height, 900)
        XCTAssertEqual(screenshot.captureKind, .display)
        XCTAssertEqual(screenshot.screenBounds, ComputerBounds(x: -720, y: 40, width: 720, height: 450))
        XCTAssertEqual(screenshot.scaleX, 0.5)
        XCTAssertEqual(screenshot.scaleY, 0.5)
        XCTAssertEqual(counter.value, 1)
    }

    func testUnauthorizedScreenshotReturnsPermissionBeforeCapturerInvocation() async {
        let counter = ScreenshotInvocationCounter()
        let service = makeScreenshotService(
            authorized: false,
            capturer: FakeScreenshotCapturer(
                screenshot: ComputerScreenshot(
                    pngBase64: Data([0x89, 0x50, 0x4E, 0x47]).base64EncodedString(),
                    width: 1,
                    height: 1,
                    captureKind: .display,
                    screenBounds: ComputerBounds(x: 0, y: 0, width: 1, height: 1),
                    scaleX: 1,
                    scaleY: 1
                ),
                counter: counter
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "screenshot-permission",
            method: "screenshot",
            params: .object([:])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_PERMISSION_REQUIRED")
        XCTAssertEqual(response.error?.message, "Screen Recording permission is required.")
        XCTAssertEqual(counter.value, 0)
    }

    func testScreenshotRejectsDecodedPngOverEightMiB() async {
        let oversized = Data(count: 8_388_609)
        let service = makeScreenshotService(
            authorized: true,
            capturer: FakeScreenshotCapturer(
                screenshot: ComputerScreenshot(
                    pngBase64: oversized.base64EncodedString(),
                    width: 4096,
                    height: 2160,
                    captureKind: .display,
                    screenBounds: ComputerBounds(x: 0, y: 0, width: 2048, height: 1080),
                    scaleX: 0.5,
                    scaleY: 0.5
                )
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "screenshot-large",
            method: "screenshot",
            params: .object([:])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_OUTPUT_LIMIT")
        XCTAssertEqual(response.error?.message, "Computer runtime output exceeded the limit.")
    }

    func testNativeScreenshotErrorDoesNotLeak() async throws {
        let service = makeScreenshotService(
            authorized: true,
            capturer: FakeScreenshotCapturer(
                screenshot: ComputerScreenshot(
                    pngBase64: "",
                    width: 0,
                    height: 0,
                    captureKind: .display,
                    screenBounds: ComputerBounds(x: 0, y: 0, width: 1, height: 1),
                    scaleX: 1,
                    scaleY: 1
                ),
                shouldThrow: true
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "screenshot-error",
            method: "screenshot",
            params: .object([:])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_UNAVAILABLE")
        XCTAssertEqual(response.error?.message, "Computer runtime is unavailable.")

        let data = try JSONEncoder().encode(response)
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(text.contains("native-screenshot-secret"))
    }

    func testFocusedWindowCropRectUsesIndependentDisplayScaleFactors() throws {
        let rect = try XCTUnwrap(WindowCaptureGeometry.cropRect(
            windowBounds: ComputerBounds(x: 120, y: 80, width: 400, height: 300),
            captureBounds: ComputerBounds(x: 100, y: 50, width: 1_000, height: 500),
            imageWidth: 2_000,
            imageHeight: 1_000
        ))

        XCTAssertEqual(rect, CGRect(x: 40, y: 60, width: 800, height: 600))
    }

    func testInteractiveScreenshotDisplaySelectionPrefersFocusedThenFallsBackSafely() {
        XCTAssertEqual(
            FocusedDisplaySelection.selectForScreenshot(
                availableDisplayIDs: [1, 9],
                focusedDisplayID: 9,
                mainDisplayID: 1
            ),
            9
        )
        XCTAssertEqual(
            FocusedDisplaySelection.selectForScreenshot(
                availableDisplayIDs: [1, 9],
                focusedDisplayID: nil,
                mainDisplayID: 1
            ),
            1
        )
        XCTAssertEqual(
            FocusedDisplaySelection.selectForScreenshot(
                availableDisplayIDs: [3, 9],
                focusedDisplayID: 7,
                mainDisplayID: 1
            ),
            3
        )
    }

    func testScreenshotCoordinateGeometryMaps1710x1112PixelsToScreenSpace() throws {
        let bounds = ComputerBounds(x: -855, y: 40, width: 855, height: 556)
        let scales = try XCTUnwrap(ScreenshotCoordinateGeometry.scaleFactors(
            screenBounds: bounds,
            imageWidth: 1_710,
            imageHeight: 1_112
        ))

        XCTAssertEqual(scales.x, 0.5)
        XCTAssertEqual(scales.y, 0.5)
        XCTAssertTrue(scales.x.isFinite)
        XCTAssertTrue(scales.y.isFinite)
        XCTAssertEqual(bounds.x + Double(1_710) * scales.x, 0)
        XCTAssertEqual(bounds.y + Double(1_112) * scales.y, 596)
    }

    func testFocusedWindowCropRectRejectsCrossDisplayBounds() {
        XCTAssertNil(WindowCaptureGeometry.cropRect(
            windowBounds: ComputerBounds(x: 900, y: 80, width: 400, height: 300),
            captureBounds: ComputerBounds(x: 100, y: 50, width: 1_000, height: 500),
            imageWidth: 2_000,
            imageHeight: 1_000
        ))
    }

    func testScreenshotRejectsNonEmptyParams() async {
        let service = makeScreenshotService(
            authorized: true,
            capturer: FakeScreenshotCapturer(
                screenshot: ComputerScreenshot(
                    pngBase64: Data([0x89, 0x50, 0x4E, 0x47]).base64EncodedString(),
                    width: 1,
                    height: 1,
                    captureKind: .display,
                    screenBounds: ComputerBounds(x: 0, y: 0, width: 1, height: 1),
                    scaleX: 1,
                    scaleY: 1
                )
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "screenshot-strict",
            method: "screenshot",
            params: .object(["extra": .bool(true)])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID")
    }
}

private enum FakeScreenshotError: Error {
    case failure(String)
}

private final class ScreenshotInvocationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func increment() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    var value: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private struct FakeScreenshotCapturer: ScreenshotCapturing {
    let screenshot: ComputerScreenshot
    let shouldThrow: Bool
    let counter: ScreenshotInvocationCounter?

    init(
        screenshot: ComputerScreenshot,
        shouldThrow: Bool = false,
        counter: ScreenshotInvocationCounter? = nil
    ) {
        self.screenshot = screenshot
        self.shouldThrow = shouldThrow
        self.counter = counter
    }

    func captureMainDisplay(maxBytes: Int) async throws -> ComputerScreenshot {
        counter?.increment()
        if shouldThrow {
            throw FakeScreenshotError.failure("native-screenshot-secret")
        }
        return screenshot
    }
}

private struct ScreenshotFakePermissions: PermissionReading {
    let screenCapture: Bool

    func accessibilityTrusted() -> Bool { false }
    func screenCaptureAuthorized() -> Bool { screenCapture }
}

private struct ScreenshotFakeWorkspace: WorkspaceReading {
    func runningApplications() -> [WorkspaceApplication] { [] }
    func frontmostApplication() -> WorkspaceApplication? { nil }
}

private func makeScreenshotService(
    authorized: Bool,
    capturer: FakeScreenshotCapturer
) -> ComputerHostService {
    ComputerHostService(
        permissions: ScreenshotFakePermissions(screenCapture: authorized),
        workspace: ScreenshotFakeWorkspace(),
        screenshot: capturer
    )
}

private func decodeScreenshotResult(from response: ComputerProtocolResponse) throws -> ComputerScreenshot {
    let result = try XCTUnwrap(response.result)
    let data = try JSONEncoder().encode(result)
    return try JSONDecoder().decode(ComputerScreenshot.self, from: data)
}
