import ComputerRuntimeCore
import Foundation

final class ComputerObservationCache: ComputerObservationCaching, @unchecked Sendable {
    private struct ContextKey: Hashable {
        let appIdentity: String
        let windowIdentity: String
        let windowGeneration: String
        let displayTopologyDigest: String
    }

    private let capacity: Int
    private let lock = NSLock()
    private var entriesByObservationId: [String: CachedComputerObservation] = [:]
    private var currentObservationIdByContext: [ContextKey: String] = [:]
    private var order: [String] = []

    init(capacity: Int) {
        self.capacity = max(1, capacity)
    }

    func store(_ observation: CachedComputerObservation) {
        let context = Self.contextKey(for: observation)
        let observationId = observation.observationId
        lock.lock()
        defer { lock.unlock() }

        if entriesByObservationId[observationId] != nil {
            order.removeAll { $0 == observationId }
        }
        entriesByObservationId[observationId] = observation
        currentObservationIdByContext[context] = observationId
        order.append(observationId)
        trimToCapacity()
    }

    func current(
        appIdentity: String,
        windowIdentity: String,
        windowGeneration: String,
        displayTopologyDigest: String
    ) -> CachedComputerObservation? {
        let context = ContextKey(
            appIdentity: appIdentity,
            windowIdentity: windowIdentity,
            windowGeneration: windowGeneration,
            displayTopologyDigest: displayTopologyDigest
        )
        lock.lock()
        defer { lock.unlock() }
        guard let observationId = currentObservationIdByContext[context] else { return nil }
        return entriesByObservationId[observationId]
    }

    func observation(snapshotId: String) -> CachedComputerObservation? {
        lock.lock()
        defer { lock.unlock() }
        return entriesByObservationId[snapshotId]
    }

    func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        entriesByObservationId.removeAll(keepingCapacity: true)
        currentObservationIdByContext.removeAll(keepingCapacity: true)
        order.removeAll(keepingCapacity: true)
    }

    func updateCapability(
        appIdentity: String,
        windowIdentity: String,
        windowGeneration: String,
        capability: PerceptionCapabilityProfile
    ) {
        lock.lock()
        defer { lock.unlock() }

        for observationId in order {
            guard let existing = entriesByObservationId[observationId],
                  existing.appIdentity == appIdentity,
                  existing.windowIdentity == windowIdentity,
                  existing.windowGeneration == windowGeneration
            else {
                continue
            }
            entriesByObservationId[observationId] = existing.replacingCapability(capability)
        }
    }

    private static func contextKey(for observation: CachedComputerObservation) -> ContextKey {
        ContextKey(
            appIdentity: observation.appIdentity,
            windowIdentity: observation.windowIdentity,
            windowGeneration: observation.windowGeneration,
            displayTopologyDigest: observation.displayTopologyDigest
        )
    }

    private func trimToCapacity() {
        while order.count > capacity {
            let oldestObservationId = order.removeFirst()
            guard let removed = entriesByObservationId.removeValue(forKey: oldestObservationId) else {
                continue
            }
            let context = Self.contextKey(for: removed)
            if currentObservationIdByContext[context] == oldestObservationId {
                currentObservationIdByContext.removeValue(forKey: context)
            }
        }
    }
}
