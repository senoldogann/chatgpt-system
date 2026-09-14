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
        let accessibility = FakeRecoveryAccessibility(elements: [windowElement()])
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
        XCTAssertEqual(result.bounds, ComputerBounds(x: 350, y: 450, width: 500, height: 175))
        XCTAssertEqual(result.actionPoint, ComputerPoint(x: 600, y: 537.5))
        let modes = await ocr.modes
        let windowCaptureCount = await capture.windowCaptureCount
        let displayCaptureCount = await capture.captureCount
        XCTAssertEqual(modes, [.fast, .accurate])
        XCTAssertEqual(windowCaptureCount, 1)
        XCTAssertEqual(displayCaptureCount, 0)
    }

    func testOcrOnASecondaryDisplayResolvesIntoThatDisplayCoordinateSpace() async throws {
        let secondaryBounds = ComputerBounds(x: 1_440, y: -180, width: 1_000, height: 500)
        let accessibility = FakeRecoveryAccessibility(elements: [windowElement(bounds: secondaryBounds)])
        let ocr = CountingOCR(
            fast: [
                OcrTextCandidate(
                    text: "Visual Submit",
                    bounds: ComputerBounds(x: 50, y: 50, width: 100, height: 25),
                    confidence: 0.95,
                    source: .fast,
                    observationId: "ocr-secondary"
                ),
            ],
            accurate: []
        )
        let capture = CountingScreenCapture(
            imageWidth: 200,
            imageHeight: 100,
            screenBounds: secondaryBounds
        )
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: ocr,
            capture: capture,
            topology: FakeRecoveryTopology(bounds: [secondaryBounds])
        )

        let result = try await engine.resolve(.ocrText(text: "Visual Submit", exact: true), retryBudget: 2)

        XCTAssertEqual(result.source, .ocr)
        XCTAssertEqual(result.bounds, ComputerBounds(x: 1_690, y: 70, width: 500, height: 125))
        XCTAssertEqual(result.actionPoint, ComputerPoint(x: 1_940, y: 132.5))
        let windowCaptureCount = await capture.windowCaptureCount
        XCTAssertEqual(windowCaptureCount, 1)
    }

    func testPersistentAmbiguityStopsWithTargetAmbiguousWithinBudget() async {
        let accessibility = FakeRecoveryAccessibility(elements: [
            windowElement(),
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
                bounds: ComputerBounds(x: 55, y: 10, width: 40, height: 20),
                confidence: 0.9,
                source: .fast,
                observationId: "ocr-a"
            ),
        ]
        let ocr = CountingOCR(fast: duplicates, accurate: duplicates)
        let engine = makeEngine(accessibility: accessibility, ocr: ocr, capture: CountingScreenCapture())

        do {
            _ = try await engine.resolve(.text(text: "Save", exact: true), retryBudget: 2)
            XCTFail("Expected targetAmbiguous")
        } catch {
            XCTAssertEqual(error as? ComputerRecoveryError, .targetAmbiguous)
        }
        XCTAssertLessThanOrEqual(accessibility.observeCount, 2)
        let modes = await ocr.modes
        XCTAssertEqual(modes, [.fast])
    }

    func testRecoveryEvidenceReportsBoundedScopedScrollGuidanceWithoutContent() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [
            windowElement(),
            scrollArea(index: 1),
        ])
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: CountingOCR(fast: [], accurate: []),
            capture: CountingScreenCapture()
        )
        let observation = try await engine.refreshObservation()
        let target = ComputerTarget.scoped(
            target: .text(text: "Sensitive Missing Label", exact: true),
            within: .index(snapshotId: observation.snapshotId, index: 1)
        )

        do {
            _ = try await engine.resolve(target, retryBudget: 0)
            XCTFail("Expected targetNotFound")
        } catch {
            XCTAssertEqual(error as? ComputerRecoveryError, .targetNotFound)
        }

        let evidence = await engine.recoveryEvidence(for: target, error: .targetNotFound)

        XCTAssertEqual(evidence.candidateCount, 0)
        XCTAssertTrue(evidence.scopeResolved)
        XCTAssertEqual(evidence.activeScrollContainerCount, 1)
        XCTAssertEqual(evidence.recommendedRecovery, .scroll)
        let encoded = try JSONEncoder().encode(evidence)
        let serialized = String(decoding: encoded, as: UTF8.self)
        XCTAssertFalse(serialized.contains("Sensitive Missing Label"))
    }

    func testRecoveryEvidenceCountsAmbiguousAXCandidatesAndRecommendsScoping() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [
            windowElement(),
            button(index: 1, title: "Sensitive Save Label", x: 10),
            button(index: 2, title: "Sensitive Save Label", x: 120),
        ])
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: CountingOCR(fast: [], accurate: []),
            capture: CountingScreenCapture()
        )
        _ = try await engine.refreshObservation()
        let target = ComputerTarget.text(text: "Sensitive Save Label", exact: true)

        do {
            _ = try await engine.resolve(target, retryBudget: 0)
            XCTFail("Expected targetAmbiguous")
        } catch {
            XCTAssertEqual(error as? ComputerRecoveryError, .targetAmbiguous)
        }

        let evidence = await engine.recoveryEvidence(for: target, error: .targetAmbiguous)

        XCTAssertEqual(evidence.candidateCount, 2)
        XCTAssertFalse(evidence.scopeResolved)
        XCTAssertEqual(evidence.activeScrollContainerCount, 0)
        XCTAssertEqual(evidence.recommendedRecovery, .scopeTarget)
        let encoded = try JSONEncoder().encode(evidence)
        let serialized = String(decoding: encoded, as: UTF8.self)
        XCTAssertFalse(serialized.contains("Sensitive Save Label"))
    }

    func testRecoveryEvidenceCountsAmbiguousOCRCandidatesWithoutContent() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [windowElement()])
        let ocr = CountingOCR(
            fast: [
                OcrTextCandidate(
                    text: "Sensitive OCR Label",
                    bounds: ComputerBounds(x: 10, y: 10, width: 30, height: 20),
                    confidence: 0.95,
                    source: .fast,
                    observationId: "ocr-evidence-a"
                ),
                OcrTextCandidate(
                    text: "Sensitive OCR Label",
                    bounds: ComputerBounds(x: 50, y: 10, width: 30, height: 20),
                    confidence: 0.94,
                    source: .fast,
                    observationId: "ocr-evidence-b"
                ),
            ],
            accurate: []
        )
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: ocr,
            capture: CountingScreenCapture(),
            controller: FakeRecoveryApplicationController(bundleIdentifier: "com.google.Chrome")
        )
        _ = try await engine.refreshObservation()
        let target = ComputerTarget.ocrText(text: "Sensitive OCR Label", exact: true)

        let evidence = await engine.recoveryEvidence(for: target, error: .targetAmbiguous)

        XCTAssertEqual(evidence.candidateCount, 2)
        XCTAssertFalse(evidence.scopeResolved)
        XCTAssertEqual(evidence.recommendedRecovery, .scopeTarget)
        let serialized = String(decoding: try JSONEncoder().encode(evidence), as: UTF8.self)
        XCTAssertFalse(serialized.contains("Sensitive OCR Label"))
    }

    func testRecoveryEvidenceDoesNotRecommendBlindScrollForUnscopedTarget() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [
            windowElement(),
            scrollArea(index: 1),
        ])
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: CountingOCR(fast: [], accurate: []),
            capture: CountingScreenCapture()
        )
        _ = try await engine.refreshObservation()
        let target = ComputerTarget.text(text: "Sensitive Missing Label", exact: true)

        let evidence = await engine.recoveryEvidence(for: target, error: .targetNotFound)

        XCTAssertEqual(evidence.candidateCount, 0)
        XCTAssertFalse(evidence.scopeResolved)
        XCTAssertEqual(evidence.activeScrollContainerCount, 1)
        XCTAssertEqual(evidence.recommendedRecovery, .screenshot)
    }

    func testVerifyContextRejectsChangedFocusedWindow() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [button(index: 1, title: "Run", x: 10)])
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: CountingOCR(fast: [], accurate: []),
            capture: CountingScreenCapture()
        )
        let resolved = try await engine.resolve(.text(text: "Run", exact: true), retryBudget: 2)

        try await engine.verifyContext(resolved)
        accessibility.windowTitle = "Different Window"

        do {
            try await engine.verifyContext(resolved)
            XCTFail("Expected stale context")
        } catch {
            XCTAssertEqual(error as? ComputerRecoveryError, .staleSnapshot)
        }
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

    func testWeakChromeObservationRunsFastFocusedWindowOCR() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [
            windowElement(),
            ComputerElementView(
                index: 2,
                role: "AXToolbar",
                subrole: nil,
                title: "Toolbar",
                description: nil,
                focused: false,
                enabled: true,
                selected: false,
                bounds: ComputerBounds(x: 0, y: 0, width: 1_000, height: 80)
            ),
        ])
        let ocr = CountingOCR(
            fast: [
                OcrTextCandidate(
                    text: "Plugins",
                    bounds: ComputerBounds(x: 20, y: 30, width: 80, height: 24),
                    confidence: 0.93,
                    source: .fast,
                    observationId: "fast-1"
                ),
            ],
            accurate: []
        )
        let capture = CountingScreenCapture(
            imageWidth: 1_000,
            imageHeight: 700,
            screenBounds: ComputerBounds(x: 100, y: 100, width: 1_000, height: 700)
        )
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: ocr,
            capture: capture,
            controller: FakeRecoveryApplicationController(bundleIdentifier: "com.google.Chrome")
        )

        let observation = try await engine.refreshObservation()

        XCTAssertEqual(observation.perception?.axQuality, .weak)
        XCTAssertEqual(observation.perception?.webContentAccessible, false)
        XCTAssertEqual(observation.perception?.ocrUsed, true)
        XCTAssertEqual(observation.perception?.recommendedTargeting, .ocr)
        XCTAssertEqual(observation.perception?.ocrCandidates.map(\.text), ["Plugins"])

        let resolved = try await engine.resolve(.ocrText(text: "Plugins", exact: true), retryBudget: 2)
        XCTAssertEqual(resolved.source, .ocr)

        let modes = await ocr.modes
        let windowCaptureCount = await capture.windowCaptureCount
        let displayCaptureCount = await capture.captureCount
        XCTAssertEqual(modes, [.fast])
        XCTAssertEqual(windowCaptureCount, 1)
        XCTAssertEqual(displayCaptureCount, 0)
    }

    func testScopedOcrTextRestrictsCandidatesToContainerBounds() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [
            windowElement(),
            ComputerElementView(
                index: 2,
                parentIndex: 0,
                depth: 1,
                role: "AXGroup",
                subrole: nil,
                title: "Plugin details",
                description: nil,
                focused: false,
                enabled: true,
                selected: false,
                bounds: ComputerBounds(x: 100, y: 100, width: 500, height: 700)
            ),
        ])
        let ocr = CountingOCR(
            fast: [
                OcrTextCandidate(
                    text: "Refresh",
                    bounds: ComputerBounds(x: 50, y: 50, width: 80, height: 24),
                    confidence: 0.95,
                    source: .fast,
                    observationId: "inner"
                ),
                OcrTextCandidate(
                    text: "Refresh",
                    bounds: ComputerBounds(x: 800, y: 50, width: 80, height: 24),
                    confidence: 0.95,
                    source: .fast,
                    observationId: "outer"
                ),
            ],
            accurate: []
        )
        let capture = CountingScreenCapture(
            imageWidth: 1_000,
            imageHeight: 700,
            screenBounds: ComputerBounds(x: 100, y: 100, width: 1_000, height: 700)
        )
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: ocr,
            capture: capture,
            controller: FakeRecoveryApplicationController(bundleIdentifier: "com.google.Chrome")
        )

        let observation = try await engine.refreshObservation()
        let resolved = try await engine.resolve(
            .scoped(
                target: .ocrText(text: "Refresh", exact: true),
                within: .index(snapshotId: observation.snapshotId, index: 2)
            ),
            retryBudget: 2
        )

        XCTAssertEqual(resolved.source, .ocr)
        XCTAssertEqual(resolved.actionPoint, ComputerPoint(x: 190, y: 162))
    }

    func testWeakChromeWithoutScreenRecordingReturnsVisualPointWithoutFailingObservation() async throws {
        let permissions = FakeRecoveryPermissions(accessibility: true, screenCapture: false)
        let accessibility = FakeRecoveryAccessibility(elements: [windowElement()])
        let ocr = CountingOCR(fast: [], accurate: [])
        let capture = CountingScreenCapture()
        let engine = makeEngine(
            permissions: permissions,
            accessibility: accessibility,
            ocr: ocr,
            capture: capture,
            controller: FakeRecoveryApplicationController(bundleIdentifier: "com.google.Chrome")
        )

        let observation = try await engine.refreshObservation()

        XCTAssertEqual(observation.perception?.axQuality, .weak)
        XCTAssertEqual(observation.perception?.webContentAccessible, false)
        XCTAssertEqual(observation.perception?.ocrUsed, false)
        XCTAssertEqual(observation.perception?.recommendedTargeting, .visualPoint)
        XCTAssertTrue(observation.perception?.ocrCandidates.isEmpty == true)
        let modes = await ocr.modes
        let windowCaptureCount = await capture.windowCaptureCount
        let displayCaptureCount = await capture.captureCount
        XCTAssertEqual(modes, [])
        XCTAssertEqual(windowCaptureCount, 0)
        XCTAssertEqual(displayCaptureCount, 0)
    }

    func testStrongChromeObservationSkipsOCR() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [
            windowElement(),
            ComputerElementView(
                index: 2,
                role: "AXWebArea",
                subrole: nil,
                title: "Page",
                description: nil,
                focused: false,
                enabled: true,
                selected: false,
                bounds: ComputerBounds(x: 100, y: 180, width: 1_000, height: 620)
            ),
        ])
        let ocr = CountingOCR(fast: [], accurate: [])
        let capture = CountingScreenCapture()
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: ocr,
            capture: capture,
            controller: FakeRecoveryApplicationController(bundleIdentifier: "com.google.Chrome")
        )

        let observation = try await engine.refreshObservation()

        XCTAssertEqual(observation.perception?.axQuality, .strong)
        XCTAssertEqual(observation.perception?.webContentAccessible, true)
        XCTAssertEqual(observation.perception?.ocrUsed, false)
        XCTAssertEqual(observation.perception?.recommendedTargeting, .ax)
        let modes = await ocr.modes
        let windowCaptureCount = await capture.windowCaptureCount
        XCTAssertEqual(modes, [])
        XCTAssertEqual(windowCaptureCount, 0)
    }

    func testMissingWindowBoundsDoesNotFallBackToFocusedDisplayOCR() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [
            ComputerElementView(
                index: 1,
                role: "AXToolbar",
                subrole: nil,
                title: "Toolbar",
                description: nil,
                focused: false,
                enabled: true,
                selected: false,
                bounds: ComputerBounds(x: 0, y: 0, width: 1_000, height: 80)
            ),
        ])
        let ocr = CountingOCR(fast: [], accurate: [])
        let capture = CountingScreenCapture()
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: ocr,
            capture: capture,
            controller: FakeRecoveryApplicationController(bundleIdentifier: "com.google.Chrome")
        )

        let observation = try await engine.refreshObservation()

        XCTAssertEqual(observation.perception?.axQuality, .weak)
        XCTAssertEqual(observation.perception?.ocrUsed, false)
        XCTAssertEqual(observation.perception?.recommendedTargeting, .visualPoint)
        let windowCaptureCount = await capture.windowCaptureCount
        let displayCaptureCount = await capture.captureCount
        let modes = await ocr.modes
        XCTAssertEqual(windowCaptureCount, 0)
        XCTAssertEqual(displayCaptureCount, 0)
        XCTAssertEqual(modes, [])
    }

    func testWeakObservationAccurateOCRRunsOnlyAfterEmptyFastPass() async throws {
        let accessibility = FakeRecoveryAccessibility(elements: [windowElement()])
        let ocr = CountingOCR(
            fast: [],
            accurate: [
                OcrTextCandidate(
                    text: "Refresh",
                    bounds: ComputerBounds(x: 10, y: 10, width: 60, height: 20),
                    confidence: 0.90,
                    source: .accurate,
                    observationId: "accurate-1"
                ),
            ]
        )
        let capture = CountingScreenCapture()
        let engine = makeEngine(
            accessibility: accessibility,
            ocr: ocr,
            capture: capture,
            controller: FakeRecoveryApplicationController(bundleIdentifier: "com.google.Chrome")
        )

        let observation = try await engine.refreshObservation()

        let modes = await ocr.modes
        let windowCaptureCount = await capture.windowCaptureCount
        XCTAssertEqual(modes, [.fast, .accurate])
        XCTAssertEqual(windowCaptureCount, 1)
        XCTAssertEqual(observation.perception?.ocrCandidates.map(\.text), ["Refresh"])
        XCTAssertEqual(observation.perception?.ocrCandidates.first?.source, .visionAccurate)
    }

    private func windowElement(
        bounds: ComputerBounds = ComputerBounds(x: 100, y: 100, width: 1_000, height: 700)
    ) -> ComputerElementView {
        ComputerElementView(
            index: 0,
            role: "AXWindow",
            subrole: nil,
            title: "Fixture Window",
            description: nil,
            focused: true,
            enabled: true,
            selected: false,
            bounds: bounds
        )
    }

    private func makeEngine(
        permissions: FakeRecoveryPermissions = FakeRecoveryPermissions(accessibility: true, screenCapture: true),
        accessibility: FakeRecoveryAccessibility,
        ocr: CountingOCR,
        capture: CountingScreenCapture,
        controller: FakeRecoveryApplicationController = FakeRecoveryApplicationController(),
        topology: FakeRecoveryTopology = FakeRecoveryTopology()
    ) -> ComputerRecoveryEngine {
        return ComputerRecoveryEngine(
            permissions: permissions,
            applicationController: controller,
            accessibility: accessibility,
            cache: ComputerObservationCache(capacity: 4),
            resolver: ComputerTargetResolver(),
            screenCapture: capture,
            ocr: ocr,
            displayTopology: topology
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

    private func scrollArea(index: Int) -> ComputerElementView {
        ComputerElementView(
            index: index,
            parentIndex: 0,
            depth: 1,
            role: "AXScrollArea",
            subrole: nil,
            title: nil,
            description: nil,
            focused: false,
            enabled: true,
            selected: false,
            bounds: ComputerBounds(x: 10, y: 50, width: 500, height: 500),
            actions: ["AXScrollDown"],
            scroll: ComputerScrollCapabilityView(scrollable: true, axes: [.vertical])
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
    private let base: WorkspaceApplication

    init(bundleIdentifier: String = "com.example.fixture") {
        self.base = WorkspaceApplication(
            processIdentifier: 101,
            name: bundleIdentifier == "com.google.Chrome" ? "Google Chrome" : "Fixture",
            bundleIdentifier: bundleIdentifier,
            frontmost: true
        )
    }

    func runningApplications() -> [WorkspaceApplication] { [frontmostApplication()!] }
    func frontmostApplication() -> WorkspaceApplication? { base }
    func applicationURL(bundleIdentifier: String) -> URL? { nil }
    func openApplication(at url: URL) async throws -> WorkspaceApplication { base }
    func activate(_ application: WorkspaceApplication) async -> Bool { true }
}

private struct FakeRecoveryTopology: DisplayTopologyReading {
    let bounds: [ComputerBounds]

    init(bounds: [ComputerBounds] = [ComputerBounds(x: 0, y: 0, width: 1_440, height: 900)]) {
        self.bounds = bounds
    }

    func activeDisplayBounds() throws -> [ComputerBounds] { bounds }
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
    private(set) var windowCaptureCount = 0

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

    func captureFocusedDisplayImage() async throws -> ScreenImageCapture {
        captureCount += 1
        return capture
    }

    func captureWindowImage(bounds: ComputerBounds) async throws -> ScreenImageCapture {
        windowCaptureCount += 1
        return ScreenImageCapture(image: capture.image, screenBounds: bounds)
    }
}
