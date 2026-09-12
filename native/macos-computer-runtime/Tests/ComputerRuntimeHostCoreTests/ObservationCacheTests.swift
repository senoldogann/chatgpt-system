import ComputerRuntimeCore
import Foundation
import XCTest
@testable import ComputerRuntimeHostCore

final class ObservationCacheTests: XCTestCase {
    func testCacheReturnsOnlyCompatibleWindowGenerationAndTopology() {
        let cache = ComputerObservationCache(capacity: 4)
        let first = cachedObservation(
            id: "obs-1",
            app: "com.example.fixture",
            window: "window-A",
            generation: "gen-1",
            topology: "topology-1"
        )

        cache.store(first)

        XCTAssertEqual(
            cache.current(
                appIdentity: "com.example.fixture",
                windowIdentity: "window-A",
                windowGeneration: "gen-1",
                displayTopologyDigest: "topology-1"
            )?.observationId,
            "obs-1"
        )
        XCTAssertNil(cache.current(
            appIdentity: "com.example.fixture",
            windowIdentity: "window-A",
            windowGeneration: "gen-2",
            displayTopologyDigest: "topology-1"
        ))
        XCTAssertNil(cache.current(
            appIdentity: "com.example.fixture",
            windowIdentity: "window-A",
            windowGeneration: "gen-1",
            displayTopologyDigest: "topology-2"
        ))
    }

    func testCacheEvictsOldestEntryAtCapacity() {
        let cache = ComputerObservationCache(capacity: 2)
        cache.store(cachedObservation(id: "obs-1", app: "app", window: "one", generation: "g1", topology: "t"))
        cache.store(cachedObservation(id: "obs-2", app: "app", window: "two", generation: "g2", topology: "t"))
        cache.store(cachedObservation(id: "obs-3", app: "app", window: "three", generation: "g3", topology: "t"))

        XCTAssertNil(cache.current(
            appIdentity: "app",
            windowIdentity: "one",
            windowGeneration: "g1",
            displayTopologyDigest: "t"
        ))
        XCTAssertEqual(cache.current(
            appIdentity: "app",
            windowIdentity: "three",
            windowGeneration: "g3",
            displayTopologyDigest: "t"
        )?.observationId, "obs-3")
    }

    func testCapabilityProfileContainsOnlyContentFreeMetadata() throws {
        let profile = PerceptionCapabilityProfile(
            axQuality: .weak,
            ocrUseful: .yes,
            lastObservationMonotonicMs: 42.5,
            windowGeneration: "gen-1"
        )

        let json = String(decoding: try JSONEncoder().encode(profile), as: UTF8.self)

        XCTAssertTrue(json.contains("weak"))
        XCTAssertTrue(json.contains("gen-1"))
        XCTAssertFalse(json.contains("Fixture Button"))
        XCTAssertFalse(json.contains("text"))
    }

    func testComputerTargetCodableUsesStableByDiscriminator() throws {
        let target = ComputerTarget.role(role: "AXButton", name: "Run", exact: true)
        let data = try JSONEncoder().encode(target)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["by"] as? String, "role")
        XCTAssertEqual(object["role"] as? String, "AXButton")
        XCTAssertEqual(object["name"] as? String, "Run")
        XCTAssertEqual(object["exact"] as? Bool, true)
        XCTAssertEqual(try JSONDecoder().decode(ComputerTarget.self, from: data), target)
    }

    func testUpdateCapabilityDoesNotReplaceObservationIdentity() {
        let cache = ComputerObservationCache(capacity: 4)
        cache.store(cachedObservation(id: "obs-1", app: "app", window: "window", generation: "gen", topology: "topology"))

        cache.updateCapability(
            appIdentity: "app",
            windowIdentity: "window",
            windowGeneration: "gen",
            capability: PerceptionCapabilityProfile(
                axQuality: .strong,
                ocrUseful: .no,
                lastObservationMonotonicMs: 84,
                windowGeneration: "gen"
            )
        )

        let current = cache.current(
            appIdentity: "app",
            windowIdentity: "window",
            windowGeneration: "gen",
            displayTopologyDigest: "topology"
        )
        XCTAssertEqual(current?.observationId, "obs-1")
        XCTAssertEqual(current?.capability.axQuality, .strong)
        XCTAssertEqual(current?.capability.ocrUseful, .no)
    }

    private func cachedObservation(
        id: String,
        app: String,
        window: String,
        generation: String,
        topology: String
    ) -> CachedComputerObservation {
        CachedComputerObservation(
            observationId: id,
            createdMonotonicMs: 10,
            appIdentity: app,
            windowIdentity: window,
            windowGeneration: generation,
            displayTopologyDigest: topology,
            observation: ComputerObservation(
                snapshotId: id,
                application: ApplicationView(name: "Fixture", bundleIdentifier: app, frontmost: true),
                windowTitle: "Fixture Window",
                elements: [],
                truncated: false,
                digest: "digest-\(id)"
            ),
            capability: PerceptionCapabilityProfile(
                axQuality: .unknown,
                ocrUseful: .unknown,
                lastObservationMonotonicMs: 10,
                windowGeneration: generation
            )
        )
    }
}
