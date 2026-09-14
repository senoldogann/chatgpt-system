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
