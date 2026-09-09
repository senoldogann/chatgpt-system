import ComputerRuntimeCore
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
                    height: 900
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
                    height: 1
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
                    height: 2160
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
                screenshot: ComputerScreenshot(pngBase64: "", width: 0, height: 0),
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

    func testScreenshotRejectsNonEmptyParams() async {
        let service = makeScreenshotService(
            authorized: true,
            capturer: FakeScreenshotCapturer(
                screenshot: ComputerScreenshot(
                    pngBase64: Data([0x89, 0x50, 0x4E, 0x47]).base64EncodedString(),
                    width: 1,
                    height: 1
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
