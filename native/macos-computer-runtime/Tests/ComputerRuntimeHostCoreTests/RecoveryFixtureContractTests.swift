import ComputerRuntimeCore
import CoreGraphics
import Foundation
import XCTest
@testable import ComputerRuntimeHostCore

// Pins the deterministic fixture vocabulary that the Slice 5 recovery scenarios
// actuate against, so renaming a fixture control cannot silently pass the suite.
final class RecoveryFixtureContractTests: XCTestCase {
    private let resolver = ComputerTargetResolver()

    func testFixtureAccessibilityControlResolvesWithoutOcr() throws {
        let context = fixtureContext(snapshotId: "fixture-obs-0", reordered: false)

        let resolved = try resolver.resolve(target: .label(label: "Fixture Button", exact: true), in: context)

        XCTAssertEqual(resolved.source, .ax)
        XCTAssertEqual(resolved.bounds, ComputerBounds(x: 30, y: 445, width: 160, height: 36))
        XCTAssertEqual(resolved.actionPoint, ComputerPoint(x: 110, y: 463))
    }

    func testFixtureDuplicateActionPairIsAmbiguous() {
        let context = fixtureContext(snapshotId: "fixture-obs-0", reordered: false)

        XCTAssertThrowsError(
            try resolver.resolve(target: .label(label: "Duplicate Action", exact: true), in: context)
        ) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .ambiguous)
        }
    }

    func testFixtureReorderMovesTheTextTargetWithoutChangingItsIdentity() throws {
        let before = try resolver.resolve(
            target: .text(text: "Reorder Alpha", exact: true),
            in: fixtureContext(snapshotId: "fixture-obs-0", reordered: false)
        )
        let after = try resolver.resolve(
            target: .text(text: "Reorder Alpha", exact: true),
            in: fixtureContext(snapshotId: "fixture-obs-1", reordered: true)
        )

        XCTAssertEqual(before.bounds, ComputerBounds(x: 30, y: 282, width: 165, height: 32))
        XCTAssertEqual(after.bounds, ComputerBounds(x: 205, y: 282, width: 165, height: 32))
        XCTAssertNotEqual(before.actionPoint, after.actionPoint)
        XCTAssertEqual(before.observationId, "fixture-obs-0")
        XCTAssertEqual(after.observationId, "fixture-obs-1")
    }

    func testFixtureIndexTargetFromAPreviousObservationIsStale() {
        let context = fixtureContext(snapshotId: "fixture-obs-1", reordered: true)

        XCTAssertThrowsError(
            try resolver.resolve(target: .index(snapshotId: "fixture-obs-0", index: 6), in: context)
        ) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .staleSnapshot)
        }
    }

    func testWeakChromeFixtureObservationResolvesUniqueOCRLabel() async throws {
        let ocr = FixtureOCR(candidates: [
            OcrTextCandidate(
                text: "Fixture Visual Submit",
                bounds: ComputerBounds(x: 50, y: 40, width: 80, height: 20),
                confidence: 0.95,
                source: .fast,
                observationId: "fixture-ocr"
            ),
        ])
        let capture = FixtureWindowCapture()
        let engine = makeOcrFixtureEngine(ocr: ocr, capture: capture)

        let observation = try await engine.refreshObservation()
        XCTAssertEqual(observation.perception?.axQuality, .weak)
        XCTAssertEqual(observation.perception?.webContentAccessible, false)
        XCTAssertEqual(observation.perception?.recommendedTargeting, .ocr)
        XCTAssertEqual(observation.perception?.ocrCandidates.map(\.text), ["Fixture Visual Submit"])

        let resolved = try await engine.resolve(
            .ocrText(text: "Fixture Visual Submit", exact: true),
            retryBudget: 2
        )
        XCTAssertEqual(resolved.source, .ocr)
        let modes = await ocr.modes
        let windowCaptures = await capture.windowCaptureCount
        let displayCaptures = await capture.displayCaptureCount
        XCTAssertEqual(modes, [.fast])
        XCTAssertEqual(windowCaptures, 1)
        XCTAssertEqual(displayCaptures, 0)
    }

    func testWeakChromeFixtureDuplicateOCRLabelsRemainAmbiguous() async throws {
        let duplicates = [
            OcrTextCandidate(
                text: "Duplicate Visual Action",
                bounds: ComputerBounds(x: 20, y: 20, width: 70, height: 20),
                confidence: 0.94,
                source: .fast,
                observationId: "fixture-ocr-duplicate"
            ),
            OcrTextCandidate(
                text: "Duplicate Visual Action",
                bounds: ComputerBounds(x: 110, y: 20, width: 70, height: 20),
                confidence: 0.93,
                source: .fast,
                observationId: "fixture-ocr-duplicate"
            ),
        ]
        let ocr = FixtureOCR(candidates: duplicates)
        let capture = FixtureWindowCapture()
        let engine = makeOcrFixtureEngine(ocr: ocr, capture: capture)

        _ = try await engine.refreshObservation()
        do {
            _ = try await engine.resolve(
                .ocrText(text: "Duplicate Visual Action", exact: true),
                retryBudget: 2
            )
            XCTFail("Expected target ambiguity")
        } catch {
            XCTAssertEqual(error as? ComputerRecoveryError, .targetAmbiguous)
        }
        let modes = await ocr.modes
        let windowCaptures = await capture.windowCaptureCount
        XCTAssertEqual(modes, [.fast])
        XCTAssertEqual(windowCaptures, 1)
    }

    func testFixtureVisualSubmitHasNoAccessibilityIdentityToResolve() {
        let context = fixtureContext(snapshotId: "fixture-obs-0", reordered: false)

        XCTAssertThrowsError(
            try resolver.resolve(target: .text(text: "Fixture Visual Submit", exact: true), in: context)
        ) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .notFound)
        }
    }

    private func makeOcrFixtureEngine(
        ocr: FixtureOCR,
        capture: FixtureWindowCapture
    ) -> ComputerRecoveryEngine {
        ComputerRecoveryEngine(
            permissions: FixtureRecoveryPermissions(),
            applicationController: FixtureRecoveryApplicationController(),
            accessibility: FixtureWeakChromeAccessibility(),
            cache: ComputerObservationCache(capacity: 4),
            resolver: ComputerTargetResolver(),
            screenCapture: capture,
            ocr: ocr,
            displayTopology: FixtureRecoveryTopology()
        )
    }

    // Mirrors the fixture window: the OCR-only submit view is deliberately absent
    // from the accessibility tree, and the reorder control swaps two sibling buttons.
    private func fixtureContext(snapshotId: String, reordered: Bool) -> ComputerTargetResolutionContext {
        let alphaX: Double = reordered ? 205 : 30
        let betaX: Double = reordered ? 30 : 205
        let elements = [
            element(index: 1, role: "AXButton", title: "Fixture Button", bounds: bounds(30, 445, 160, 36)),
            element(index: 2, role: "AXCheckBox", title: "Fixture Checkbox", bounds: bounds(420, 445, 180, 32)),
            element(index: 3, role: "AXTextField", title: "Fixture Text Field", bounds: bounds(30, 375, 300, 30)),
            element(index: 4, role: "AXButton", title: "Duplicate Action", bounds: bounds(30, 330, 160, 32)),
            element(index: 5, role: "AXButton", title: "Duplicate Action", bounds: bounds(200, 330, 160, 32)),
            element(index: 6, role: "AXButton", title: "Reorder Alpha", bounds: bounds(alphaX, 282, 165, 32)),
            element(index: 7, role: "AXButton", title: "Reorder Beta", bounds: bounds(betaX, 282, 165, 32)),
            element(index: 8, role: "AXButton", title: "Reorder Targets", bounds: bounds(400, 330, 170, 32)),
        ]
        let observation = ComputerObservation(
            snapshotId: snapshotId,
            application: ApplicationView(
                name: "Computer Runtime v2 Fixture",
                bundleIdentifier: "com.senoldogann.chatgpt-system.computer-runtime.fixture",
                frontmost: true
            ),
            windowTitle: "Computer Runtime v2 Fixture",
            elements: elements,
            truncated: false,
            digest: "digest-\(snapshotId)"
        )
        return ComputerTargetResolutionContext(
            cached: CachedComputerObservation(
                observationId: snapshotId,
                createdMonotonicMs: 10,
                appIdentity: "com.senoldogann.chatgpt-system.computer-runtime.fixture",
                windowIdentity: "fixture-window",
                windowGeneration: reordered ? "generation-2" : "generation-1",
                displayTopologyDigest: "topology-current",
                observation: observation,
                capability: PerceptionCapabilityProfile(
                    axQuality: .strong,
                    ocrUseful: .unknown,
                    lastObservationMonotonicMs: 10,
                    windowGeneration: reordered ? "generation-2" : "generation-1"
                )
            ),
            currentDisplayTopologyDigest: "topology-current",
            activeDisplays: [bounds(0, 0, 1_440, 900)]
        )
    }

    private func element(
        index: Int,
        role: String,
        title: String,
        bounds: ComputerBounds
    ) -> ComputerElementView {
        ComputerElementView(
            index: index,
            role: role,
            subrole: nil,
            title: title,
            description: nil,
            focused: false,
            enabled: true,
            selected: false,
            bounds: bounds
        )
    }

    private func bounds(_ x: Double, _ y: Double, _ width: Double, _ height: Double) -> ComputerBounds {
        ComputerBounds(x: x, y: y, width: width, height: height)
    }
}


private struct FixtureRecoveryPermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { true }
    func screenCaptureAuthorized() -> Bool { true }
    func eventListenAuthorized() -> Bool { true }
    func eventPostAuthorized() -> Bool { true }
}

private final class FixtureRecoveryApplicationController: ApplicationControlling, @unchecked Sendable {
    private let chrome = WorkspaceApplication(
        processIdentifier: 701,
        name: "Google Chrome",
        bundleIdentifier: "com.google.Chrome",
        frontmost: true
    )

    func runningApplications() -> [WorkspaceApplication] { [chrome] }
    func frontmostApplication() -> WorkspaceApplication? { chrome }
    func applicationURL(bundleIdentifier: String) -> URL? { nil }
    func openApplication(at url: URL) async throws -> WorkspaceApplication { chrome }
    func activate(_ application: WorkspaceApplication) async -> Bool { true }
}

private struct FixtureWeakChromeAccessibility: AccessibilityReading {
    private let window = ComputerBounds(x: 100, y: 100, width: 800, height: 600)

    func activeWindow(for application: WorkspaceApplication) throws -> ActiveWindowView {
        ActiveWindowView(application: application.view, title: "Fixture Browser Window")
    }

    func observe(for application: WorkspaceApplication, limits: ObservationLimits) throws -> ComputerObservation {
        ComputerObservation(
            snapshotId: "fixture-weak-chrome",
            application: application.view,
            windowTitle: "Fixture Browser Window",
            elements: [
                ComputerElementView(
                    index: 0,
                    role: "AXWindow",
                    subrole: nil,
                    title: "Fixture Browser Window",
                    description: nil,
                    focused: true,
                    enabled: true,
                    selected: false,
                    bounds: window
                ),
                ComputerElementView(
                    index: 1,
                    role: "AXToolbar",
                    subrole: nil,
                    title: "Toolbar",
                    description: nil,
                    focused: false,
                    enabled: true,
                    selected: false,
                    bounds: ComputerBounds(x: 100, y: 100, width: 800, height: 80)
                ),
            ],
            truncated: false
        )
    }
}

private struct FixtureRecoveryTopology: DisplayTopologyReading {
    func activeDisplayBounds() throws -> [ComputerBounds] {
        [ComputerBounds(x: 0, y: 0, width: 1_440, height: 900)]
    }
}

private actor FixtureOCR: VisionTextRecognizing {
    let candidates: [OcrTextCandidate]
    private(set) var modes: [VisionRecognitionMode] = []

    init(candidates: [OcrTextCandidate]) {
        self.candidates = candidates
    }

    func recognizeText(in image: CGImage, mode: VisionRecognitionMode) async throws -> [OcrTextCandidate] {
        modes.append(mode)
        return mode == .fast ? candidates : []
    }
}

private actor FixtureWindowCapture: ScreenImageCapturing {
    private let image: CGImage
    private(set) var windowCaptureCount = 0
    private(set) var displayCaptureCount = 0

    init() {
        let space = CGColorSpaceCreateDeviceRGB()
        let context = CGContext(
            data: nil,
            width: 200,
            height: 100,
            bitsPerComponent: 8,
            bytesPerRow: 800,
            space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        self.image = context.makeImage()!
    }

    func captureFocusedDisplayImage() async throws -> ScreenImageCapture {
        displayCaptureCount += 1
        return ScreenImageCapture(
            image: image,
            screenBounds: ComputerBounds(x: 0, y: 0, width: 1_440, height: 900)
        )
    }

    func captureWindowImage(bounds: ComputerBounds) async throws -> ScreenImageCapture {
        windowCaptureCount += 1
        return ScreenImageCapture(image: image, screenBounds: bounds)
    }
}
