import ComputerRuntimeCore
import Foundation

final class ComputerObservationCache: ComputerObservationCaching, @unchecked Sendable {
    private struct Key: Hashable {
        let appIdentity: String
        let windowIdentity: String
        let windowGeneration: String
        let displayTopologyDigest: String
    }

    private let capacity: Int
    private let lock = NSLock()
    private var entries: [Key: CachedComputerObservation] = [:]
    private var order: [Key] = []

    init(capacity: Int) {
        self.capacity = max(1, capacity)
    }

    func store(_ observation: CachedComputerObservation) {
        let key = Self.key(for: observation)
        lock.lock()
        defer { lock.unlock() }

        if entries[key] != nil {
            order.removeAll { $0 == key }
        }
        entries[key] = observation
        order.append(key)
        trimToCapacity()
    }

    func current(
        appIdentity: String,
        windowIdentity: String,
        windowGeneration: String,
        displayTopologyDigest: String
    ) -> CachedComputerObservation? {
        let key = Key(
            appIdentity: appIdentity,
            windowIdentity: windowIdentity,
            windowGeneration: windowGeneration,
            displayTopologyDigest: displayTopologyDigest
        )
        lock.lock()
        defer { lock.unlock() }
        return entries[key]
    }

    func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        entries.removeAll(keepingCapacity: true)
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

        for key in order where
            key.appIdentity == appIdentity &&
            key.windowIdentity == windowIdentity &&
            key.windowGeneration == windowGeneration
        {
            guard let existing = entries[key] else { continue }
            entries[key] = existing.replacingCapability(capability)
        }
    }

    private static func key(for observation: CachedComputerObservation) -> Key {
        Key(
            appIdentity: observation.appIdentity,
            windowIdentity: observation.windowIdentity,
            windowGeneration: observation.windowGeneration,
            displayTopologyDigest: observation.displayTopologyDigest
        )
    }

    private func trimToCapacity() {
        while order.count > capacity {
            let oldest = order.removeFirst()
            entries.removeValue(forKey: oldest)
        }
    }
}
