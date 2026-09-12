import ComputerRuntimeCore
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

    func testFixtureVisualSubmitHasNoAccessibilityIdentityToResolve() {
        let context = fixtureContext(snapshotId: "fixture-obs-0", reordered: false)

        XCTAssertThrowsError(
            try resolver.resolve(target: .text(text: "Fixture Visual Submit", exact: true), in: context)
        ) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .notFound)
        }
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
