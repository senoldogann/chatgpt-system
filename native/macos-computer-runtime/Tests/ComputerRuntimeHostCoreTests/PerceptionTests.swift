import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class PerceptionTests: XCTestCase {
    func testChromeToolbarOnlyAXIsWeakAndWebInaccessible() {
        let observation = makeObservation(
            bundleIdentifier: "com.google.Chrome",
            roles: ["AXWindow", "AXToolbar", "AXTextField"],
            truncated: false
        )

        let summary = ComputerPerception.classify(observation: observation)

        XCTAssertEqual(summary.axQuality, .weak)
        XCTAssertEqual(summary.webContentAccessible, false)
        XCTAssertFalse(summary.ocrUsed)
        XCTAssertEqual(summary.recommendedTargeting, .ocr)
        XCTAssertTrue(summary.ocrCandidates.isEmpty)
    }

    func testChromeAXWebAreaIsStrongAndWebAccessible() {
        let observation = makeObservation(
            bundleIdentifier: "com.google.Chrome",
            roles: ["AXWindow", "AXWebArea", "AXHeading"],
            truncated: false
        )

        let summary = ComputerPerception.classify(observation: observation)

        XCTAssertEqual(summary.axQuality, .strong)
        XCTAssertEqual(summary.webContentAccessible, true)
        XCTAssertEqual(summary.recommendedTargeting, .ax)
    }

    func testChromeWebAreaTruncationIsPartialButStillAccessible() {
        let observation = makeObservation(
            bundleIdentifier: "com.google.Chrome",
            roles: ["AXWindow", "AXWebArea"],
            truncated: true
        )

        let summary = ComputerPerception.classify(observation: observation)

        XCTAssertEqual(summary.axQuality, .partial)
        XCTAssertEqual(summary.webContentAccessible, true)
        XCTAssertEqual(summary.recommendedTargeting, .ax)
    }

    func testNonChromeEmptyTreeIsWeakButWebCapabilityIsNotApplicable() {
        let observation = makeObservation(
            bundleIdentifier: "com.apple.TextEdit",
            roles: [],
            truncated: false
        )

        let summary = ComputerPerception.classify(observation: observation)

        XCTAssertEqual(summary.axQuality, .weak)
        XCTAssertNil(summary.webContentAccessible)
        XCTAssertEqual(summary.recommendedTargeting, .ocr)
    }

    func testBoundedCandidatesFiltersLowConfidenceAndMapsToScreenSpace() {
        let candidates = [
            OcrTextCandidate(
                text: "drop",
                bounds: ComputerBounds(x: 1, y: 1, width: 10, height: 10),
                confidence: 0.49,
                source: .fast,
                observationId: "ocr"
            ),
            OcrTextCandidate(
                text: "Plugins",
                bounds: ComputerBounds(x: 10, y: 20, width: 30, height: 10),
                confidence: 0.5,
                source: .fast,
                observationId: "ocr"
            ),
        ]

        let bounded = ComputerPerception.boundedCandidates(
            candidates,
            imageWidth: 100,
            imageHeight: 100,
            captureBounds: ComputerBounds(x: 100, y: 200, width: 200, height: 300)
        )

        XCTAssertEqual(bounded.count, 1)
        XCTAssertEqual(bounded.first?.text, "Plugins")
        XCTAssertEqual(bounded.first?.bounds, ComputerBounds(x: 120, y: 260, width: 60, height: 30))
        XCTAssertEqual(try XCTUnwrap(bounded.first?.confidence), 0.5, accuracy: 0.0001)
        XCTAssertEqual(bounded.first?.source, .visionFast)
    }

    func testBoundedCandidatesEnforcesCountAndAggregateTextLimits() {
        let shortCandidates = (0..<80).map { index in
            OcrTextCandidate(
                text: String(repeating: "s", count: 100),
                bounds: ComputerBounds(x: Double(index % 10), y: Double(index % 10), width: 1, height: 1),
                confidence: 0.9,
                source: .fast,
                observationId: "short-\(index)"
            )
        }
        let countBounded = ComputerPerception.boundedCandidates(
            shortCandidates,
            imageWidth: 100,
            imageHeight: 100,
            captureBounds: ComputerBounds(x: 0, y: 0, width: 100, height: 100)
        )
        XCTAssertEqual(countBounded.count, 64)

        let longCandidates = (0..<80).map { index in
            OcrTextCandidate(
                text: String(repeating: "x", count: 600),
                bounds: ComputerBounds(x: Double(index % 10), y: Double(index % 10), width: 1, height: 1),
                confidence: 0.9,
                source: .accurate,
                observationId: "long-\(index)"
            )
        }
        let aggregateBounded = ComputerPerception.boundedCandidates(
            longCandidates,
            imageWidth: 100,
            imageHeight: 100,
            captureBounds: ComputerBounds(x: 0, y: 0, width: 100, height: 100)
        )
        XCTAssertTrue(aggregateBounded.allSatisfy { $0.text.count <= 512 })
        XCTAssertLessThanOrEqual(aggregateBounded.map(\.text.count).reduce(0, +), 8_192)
        XCTAssertTrue(aggregateBounded.allSatisfy { $0.source == .visionAccurate })
    }

    func testFocusedWindowBoundsPrefersFocusedAXWindow() {
        let app = ApplicationView(name: "Chrome", bundleIdentifier: "com.google.Chrome", frontmost: true)
        let observation = ComputerObservation(
            snapshotId: "snapshot",
            application: app,
            windowTitle: "Window",
            elements: [
                ComputerElementView(
                    index: 0,
                    role: "AXWindow",
                    subrole: nil,
                    title: "Background",
                    description: nil,
                    focused: false,
                    enabled: true,
                    selected: nil,
                    bounds: ComputerBounds(x: 1, y: 2, width: 300, height: 200)
                ),
                ComputerElementView(
                    index: 1,
                    role: "AXWindow",
                    subrole: nil,
                    title: "Front",
                    description: nil,
                    focused: true,
                    enabled: true,
                    selected: nil,
                    bounds: ComputerBounds(x: 10, y: 20, width: 800, height: 600)
                ),
            ],
            truncated: false
        )

        XCTAssertEqual(
            ComputerPerception.focusedWindowBounds(in: observation),
            ComputerBounds(x: 10, y: 20, width: 800, height: 600)
        )
    }

    func testFocusedWindowBoundsPrefersExplicitFocusOverUnknownFocus() {
        let app = ApplicationView(name: "Chrome", bundleIdentifier: "com.google.Chrome", frontmost: true)
        let observation = ComputerObservation(
            snapshotId: "snapshot",
            application: app,
            windowTitle: "Window",
            elements: [
                ComputerElementView(
                    index: 0,
                    role: "AXWindow",
                    subrole: nil,
                    title: "Unknown",
                    description: nil,
                    focused: nil,
                    enabled: true,
                    selected: nil,
                    bounds: ComputerBounds(x: 1, y: 2, width: 300, height: 200)
                ),
                ComputerElementView(
                    index: 1,
                    role: "AXWindow",
                    subrole: nil,
                    title: "Front",
                    description: nil,
                    focused: true,
                    enabled: true,
                    selected: nil,
                    bounds: ComputerBounds(x: 10, y: 20, width: 800, height: 600)
                ),
            ],
            truncated: false
        )

        XCTAssertEqual(
            ComputerPerception.focusedWindowBounds(in: observation),
            ComputerBounds(x: 10, y: 20, width: 800, height: 600)
        )
    }
}

private func makeObservation(
    bundleIdentifier: String,
    roles: [String],
    truncated: Bool
) -> ComputerObservation {
    let app = ApplicationView(name: "Fixture", bundleIdentifier: bundleIdentifier, frontmost: true)
    return ComputerObservation(
        snapshotId: "snapshot",
        application: app,
        windowTitle: "Window",
        elements: roles.enumerated().map { index, role in
            ComputerElementView(
                index: index,
                role: role,
                subrole: nil,
                title: role,
                description: nil,
                focused: role == "AXWindow" ? true : nil,
                enabled: true,
                selected: nil,
                bounds: ComputerBounds(x: 10, y: 20, width: 800, height: 600)
            )
        },
        truncated: truncated
    )
}
