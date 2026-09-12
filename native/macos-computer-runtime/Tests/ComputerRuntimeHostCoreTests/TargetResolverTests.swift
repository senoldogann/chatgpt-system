import ComputerRuntimeCore
import XCTest
@testable import ComputerRuntimeHostCore

final class TargetResolverTests: XCTestCase {
    private let resolver = ComputerTargetResolver()

    func testRoleTargetResolvesOneExactCandidateAtBoundsCenter() throws {
        let context = makeContext(elements: [
            element(index: 2, role: "AXButton", title: "Run", bounds: bounds(10, 20, 80, 30)),
        ])

        let resolved = try resolver.resolve(
            target: .role(role: "AXButton", name: "Run", exact: true),
            in: context
        )

        XCTAssertEqual(resolved.source, .ax)
        XCTAssertEqual(resolved.actionPoint, ComputerPoint(x: 50, y: 35))
        XCTAssertEqual(resolved.bounds, bounds(10, 20, 80, 30))
        XCTAssertEqual(resolved.observationId, "obs-current")
        XCTAssertNotNil(resolved.semanticFingerprint)
    }

    func testDuplicateTextIsAmbiguous() {
        let context = makeContext(elements: [
            element(index: 1, role: "AXButton", title: "Save", bounds: bounds(10, 10, 80, 30)),
            element(index: 2, role: "AXButton", title: "Save", bounds: bounds(100, 10, 80, 30)),
        ])

        XCTAssertThrowsError(try resolver.resolve(target: .text(text: "Save", exact: true), in: context)) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .ambiguous)
        }
    }

    func testOldIndexSnapshotIsStaleBeforeIndexLookup() {
        let context = makeContext(elements: [
            element(index: 3, role: "AXButton", title: "Run", bounds: bounds(10, 10, 80, 30)),
        ])

        XCTAssertThrowsError(try resolver.resolve(target: .index(snapshotId: "obs-old", index: 3), in: context)) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .staleSnapshot)
        }
    }

    func testTopologyMismatchMakesCachedObservationStale() {
        var context = makeContext(elements: [
            element(index: 3, role: "AXButton", title: "Run", bounds: bounds(10, 10, 80, 30)),
        ])
        context = ComputerTargetResolutionContext(
            cached: context.cached,
            currentDisplayTopologyDigest: "topology-new",
            activeDisplays: context.activeDisplays
        )

        XCTAssertThrowsError(try resolver.resolve(target: .text(text: "Run", exact: true), in: context)) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .staleSnapshot)
        }
    }

    func testSemanticCandidateOutsideDisplayIsUnsafeGeometry() {
        let context = makeContext(elements: [
            element(index: 1, role: "AXButton", title: "Run", bounds: bounds(2_000, 10, 80, 30)),
        ])

        XCTAssertThrowsError(try resolver.resolve(target: .text(text: "Run", exact: true), in: context)) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .unsafeGeometry)
        }
    }

    func testDisabledCandidateIsNotAValidMutationTarget() {
        let context = makeContext(elements: [
            element(index: 1, role: "AXButton", title: "Run", enabled: false, bounds: bounds(10, 10, 80, 30)),
        ])

        XCTAssertThrowsError(try resolver.resolve(target: .text(text: "Run", exact: true), in: context)) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .notFound)
        }
    }

    func testNonExactTextUsesDeterministicNormalizedContainment() throws {
        let context = makeContext(elements: [
            element(index: 1, role: "AXButton", title: "  Build   Project  ", bounds: bounds(10, 10, 80, 30)),
        ])

        let resolved = try resolver.resolve(target: .text(text: "build project", exact: false), in: context)

        XCTAssertEqual(resolved.source, .ax)
        XCTAssertEqual(resolved.actionPoint, ComputerPoint(x: 50, y: 25))
    }

    func testOcrTargetIsNotResolvedByAxResolver() {
        let context = makeContext(elements: [
            element(index: 1, role: "AXStaticText", title: "Visual Submit", bounds: bounds(10, 10, 80, 30)),
        ])

        XCTAssertThrowsError(try resolver.resolve(target: .ocrText(text: "Visual Submit", exact: true), in: context)) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .notFound)
        }
    }

    func testExplicitPointMustBeInsideCurrentDisplay() throws {
        let context = makeContext(elements: [])

        let resolved = try resolver.resolve(target: .point(x: 100, y: 200), in: context)
        XCTAssertEqual(resolved.source, .point)
        XCTAssertEqual(resolved.actionPoint, ComputerPoint(x: 100, y: 200))
        XCTAssertEqual(resolved.confidence, .explicit)

        XCTAssertThrowsError(try resolver.resolve(target: .point(x: 3_000, y: 200), in: context)) {
            XCTAssertEqual($0 as? ComputerTargetResolutionError, .unsafeGeometry)
        }
    }

    private func makeContext(elements: [ComputerElementView]) -> ComputerTargetResolutionContext {
        let capability = PerceptionCapabilityProfile(
            axQuality: .strong,
            ocrUseful: .unknown,
            lastObservationMonotonicMs: 10,
            windowGeneration: "generation-1"
        )
        let observation = ComputerObservation(
            snapshotId: "obs-current",
            application: ApplicationView(name: "Fixture", bundleIdentifier: "com.example.fixture", frontmost: true),
            windowTitle: "Fixture Window",
            elements: elements,
            truncated: false,
            digest: "digest-current"
        )
        return ComputerTargetResolutionContext(
            cached: CachedComputerObservation(
                observationId: "obs-current",
                createdMonotonicMs: 10,
                appIdentity: "com.example.fixture",
                windowIdentity: "window-identity",
                windowGeneration: "generation-1",
                displayTopologyDigest: "topology-current",
                observation: observation,
                capability: capability
            ),
            currentDisplayTopologyDigest: "topology-current",
            activeDisplays: [bounds(0, 0, 1_440, 900)]
        )
    }

    private func element(
        index: Int,
        role: String,
        title: String?,
        description: String? = nil,
        enabled: Bool? = true,
        bounds: ComputerBounds?
    ) -> ComputerElementView {
        ComputerElementView(
            index: index,
            role: role,
            subrole: nil,
            title: title,
            description: description,
            focused: false,
            enabled: enabled,
            selected: false,
            bounds: bounds
        )
    }

    private func bounds(_ x: Double, _ y: Double, _ width: Double, _ height: Double) -> ComputerBounds {
        ComputerBounds(x: x, y: y, width: width, height: height)
    }
}
