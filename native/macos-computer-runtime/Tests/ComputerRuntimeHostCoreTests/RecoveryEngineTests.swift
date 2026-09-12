import ComputerRuntimeCore
import CoreGraphics
import Foundation
import XCTest
@testable import ComputerRuntimeHostCore

final class RecoveryEngineTests: XCTestCase {
    func testAxSuccessNeverInvokesOcrAndSecondResolveUsesCache() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [button(index: 1, title: "Run", x: 10)])
        let ocr = CountingOCR(fast: [], accurate: [])
        let capture = CountingScreenCapture()
        let engine = makeEngine(accessibility: accessibility, ocr: ocr, capture: capture)

        let first = try await engine.resolve(.text(text: "Run", exact: true), retryBudget: 2)
        let second = try await engine.resolve(.text(text: "Run", exact: true), retryBudget: 2)

        XCTAssertEqual(first.source, .ax)
        XCTAssertEqual(second.source, .ax)
        XCTAssertEqual(accessibility.observeCount, 1)
        let modes = await ocr.modes
        let captureCount = await capture.captureCount
        XCTAssertEqual(modes, [])
        XCTAssertEqual(captureCount, 0)
    }

    func testWeakAxFallsBackFastThenAccurateOcrUsingOneCapture() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [])
        let ocr = CountingOCR(
            fast: [],
            accurate: [
                OcrTextCandidate(
                    text: "Canvas Submit",
                    bounds: ComputerBounds(x: 50, y: 50, width: 100, height: 25),
                    confidence: 0.95,
                    source: .accurate,
                    observationId: "ocr-1"
                ),
            ]
        )
        let capture = CountingScreenCapture(
            imageWidth: 200,
            imageHeight: 100,
            screenBounds: ComputerBounds(x: 0, y: 0, width: 1_000, height: 500)
        )
        let engine = makeEngine(accessibility: accessibility, ocr: ocr, capture: capture)

        let result = try await engine.resolve(.ocrText(text: "Canvas Submit", exact: true), retryBudget: 2)

        XCTAssertEqual(result.source, .ocr)
        XCTAssertEqual(result.bounds, ComputerBounds(x: 250, y: 250, width: 500, height: 125))
        XCTAssertEqual(result.actionPoint, ComputerPoint(x: 500, y: 312.5))
        let modes = await ocr.modes
        let captureCount = await capture.captureCount
        XCTAssertEqual(modes, [.fast, .accurate])
        XCTAssertEqual(captureCount, 1)
    }

    func testPersistentAmbiguityStopsWithNeedsReplanWithinBudget() async {
        let accessibility = FakeRecoveryAccessibility(elements: [
            button(index: 1, title: "Save", x: 10),
            button(index: 2, title: "Save", x: 120),
        ])
        let duplicates = [
            OcrTextCandidate(
                text: "Save",
                bounds: ComputerBounds(x: 10, y: 10, width: 40, height: 20),
                confidence: 0.9,
                source: .fast,
                observationId: "ocr-a"
            ),
            OcrTextCandidate(
                text: "Save",
                bounds: ComputerBounds(x: 80, y: 10, width: 40, height: 20),
                confidence: 0.9,
                source: .fast,
                observationId: "ocr-a"
            ),
        ]
        let ocr = CountingOCR(fast: duplicates, accurate: duplicates)
        let engine = makeEngine(accessibility: accessibility, ocr: ocr, capture: CountingScreenCapture())

        do {
            _ = try await engine.resolve(.text(text: "Save", exact: true), retryBudget: 2)
            XCTFail("Expected needsReplan")
        } catch {
            XCTAssertEqual(error as? ComputerRecoveryError, .needsReplan)
        }
        XCTAssertLessThanOrEqual(accessibility.observeCount, 2)
        let modes = await ocr.modes
        XCTAssertEqual(modes, [.fast, .accurate])
    }

    func testAccessibilityPermissionLossIsTerminalAndDoesNotInvokeOcr() async {
        let permissions = FakeRecoveryPermissions(accessibility: false, screenCapture: true)
        let ocr = CountingOCR(fast: [], accurate: [])
        let engine = makeEngine(
            permissions: permissions,
            accessibility: FakeRecoveryAccessibility(elements: []),
            ocr: ocr,
            capture: CountingScreenCapture()
        )

        do {
            _ = try await engine.resolve(.text(text: "Run", exact: true), retryBudget: 2)
            XCTFail("Expected permissionRequired")
        } catch {
            XCTAssertEqual(error as? ComputerRecoveryError, .permissionRequired)
        }
        let modes = await ocr.modes
        XCTAssertEqual(modes, [])
    }

    func testStaleIndexedTargetReResolvesByPriorSemanticIdentity() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [button(index: 1, title: "Run", x: 10)])
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: CountingOCR(fast: [], accurate: []),
            capture: CountingScreenCapture()
        )

        let oldObservation = try await engine.refreshObservation()
        accessibility.elements = [button(index: 7, title: "Run", x: 300)]
        _ = try await engine.refreshObservation()

        let resolved = try await engine.resolve(
            .index(snapshotId: oldObservation.snapshotId, index: 1),
            retryBudget: 2
        )

        XCTAssertEqual(resolved.source, .ax)
        XCTAssertEqual(resolved.actionPoint, ComputerPoint(x: 340, y: 25))
        XCTAssertNotEqual(resolved.observationId, oldObservation.snapshotId)
    }

    private func makeEngine(
        permissions: FakeRecoveryPermissions = FakeRecoveryPermissions(accessibility: true, screenCapture: true),
        accessibility: FakeRecoveryAccessibility,
        ocr: CountingOCR,
        capture: CountingScreenCapture
    ) -> ComputerRecoveryEngine {
        let controller = FakeRecoveryApplicationController()
        return ComputerRecoveryEngine(
            permissions: permissions,
            applicationController: controller,
            accessibility: accessibility,
            cache: ComputerObservationCache(capacity: 4),
            resolver: ComputerTargetResolver(),
            screenCapture: capture,
            ocr: ocr,
            displayTopology: FakeRecoveryTopology()
        )
    }

    private func button(index: Int, title: String, x: Double) -> ComputerElementView {
        ComputerElementView(
            index: index,
            role: "AXButton",
            subrole: nil,
            title: title,
            description: nil,
            focused: false,
            enabled: true,
            selected: false,
            bounds: ComputerBounds(x: x, y: 10, width: 80, height: 30)
        )
    }
}

private struct FakeRecoveryPermissions: PermissionReading {
    let accessibility: Bool
    let screenCapture: Bool

    func accessibilityTrusted() -> Bool { accessibility }
    func screenCaptureAuthorized() -> Bool { screenCapture }
    func eventListenAuthorized() -> Bool { true }
    func eventPostAuthorized() -> Bool { true }
}

private final class FakeRecoveryAccessibility: AccessibilityReading, @unchecked Sendable {
    var elements: [ComputerElementView]
    var observeCount = 0
    var windowTitle = "Fixture Window"

    init(elements: [ComputerElementView]) {
        self.elements = elements
    }

    func activeWindow(for application: WorkspaceApplication) throws -> ActiveWindowView {
        ActiveWindowView(application: application.view, title: windowTitle)
    }

    func observe(for application: WorkspaceApplication, limits: ObservationLimits) throws -> ComputerObservation {
        observeCount += 1
        return ComputerObservation(
            snapshotId: "obs-\(observeCount)",
            application: application.view,
            windowTitle: windowTitle,
            elements: Array(elements.prefix(limits.maxElements)),
            truncated: elements.count > limits.maxElements
        )
    }
}

private final class FakeRecoveryApplicationController: ApplicationControlling, @unchecked Sendable {
    private let base = WorkspaceApplication(
        processIdentifier: 101,
        name: "Fixture",
        bundleIdentifier: "com.example.fixture",
        frontmost: true
    )

    func runningApplications() -> [WorkspaceApplication] { [frontmostApplication()!] }
    func frontmostApplication() -> WorkspaceApplication? { base }
    func applicationURL(bundleIdentifier: String) -> URL? { nil }
    func openApplication(at url: URL) async throws -> WorkspaceApplication { base }
    func activate(_ application: WorkspaceApplication) async -> Bool { true }
}

private struct FakeRecoveryTopology: DisplayTopologyReading {
    func activeDisplayBounds() throws -> [ComputerBounds] {
        [ComputerBounds(x: 0, y: 0, width: 1_440, height: 900)]
    }
}

private actor CountingOCR: VisionTextRecognizing {
    private let fast: [OcrTextCandidate]
    private let accurate: [OcrTextCandidate]
    private(set) var modes: [VisionRecognitionMode] = []

    init(fast: [OcrTextCandidate], accurate: [OcrTextCandidate]) {
        self.fast = fast
        self.accurate = accurate
    }

    func recognizeText(in image: CGImage, mode: VisionRecognitionMode) async throws -> [OcrTextCandidate] {
        modes.append(mode)
        return mode == .fast ? fast : accurate
    }
}

private actor CountingScreenCapture: ScreenImageCapturing {
    private let capture: ScreenImageCapture
    private(set) var captureCount = 0

    init(
        imageWidth: Int = 100,
        imageHeight: Int = 100,
        screenBounds: ComputerBounds = ComputerBounds(x: 0, y: 0, width: 1_440, height: 900)
    ) {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = CGContext(
            data: nil,
            width: imageWidth,
            height: imageHeight,
            bitsPerComponent: 8,
            bytesPerRow: imageWidth * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        self.capture = ScreenImageCapture(image: context.makeImage()!, screenBounds: screenBounds)
    }

    func captureMainDisplayImage() async throws -> ScreenImageCapture {
        captureCount += 1
        return capture
    }
}
