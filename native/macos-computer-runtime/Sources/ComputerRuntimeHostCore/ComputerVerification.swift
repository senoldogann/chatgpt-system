import ComputerRuntimeCore
import CryptoKit
import Foundation

enum ComputerVerificationError: Error, Equatable, Sendable {
    case timeout
    case focusFailed
    case invalidRegion
    case unavailable
}

protocol ScreenRegionDigesting: Sendable {
    func digest(bounds: ComputerBounds) async throws -> String
}

protocol ComputerVerificationHandling: Sendable {
    func currentAXDigest() throws -> String
    func currentFocusedElementIndex() throws -> Int?
    func waitForFrontmost(_ selector: ComputerApplicationSelector, timeoutMs: Int) async throws -> ApplicationView
    func waitForText(_ text: String, exact: Bool, timeoutMs: Int) async throws
    func waitUntilAXChanged(from baselineDigest: String, timeoutMs: Int) async throws -> String
    func currentScreenRegionDigest(bounds: ComputerBounds) async throws -> String
    func waitUntilScreenRegionChanged(bounds: ComputerBounds, from baselineDigest: String, timeoutMs: Int) async throws -> String
}

enum ObservationDigest {
    private struct Payload: Codable {
        let application: ApplicationView
        let windowTitle: String?
        let elements: [ComputerElementView]
        let truncated: Bool
    }

    static func digest(_ observation: ComputerObservation) throws -> String {
        let payload = Payload(
            application: observation.application,
            windowTitle: observation.windowTitle,
            elements: observation.elements,
            truncated: observation.truncated
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(payload)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

struct ComputerVerificationEngine: ComputerVerificationHandling, Sendable {
    private static let pollIntervalNanoseconds: UInt64 = 20_000_000

    private let workspace: any WorkspaceReading
    private let accessibility: any AccessibilityReading
    private let screenDigester: any ScreenRegionDigesting
    private let sleeper: any InputSleeping

    init(
        workspace: any WorkspaceReading,
        accessibility: any AccessibilityReading,
        screenDigester: any ScreenRegionDigesting,
        sleeper: any InputSleeping
    ) {
        self.workspace = workspace
        self.accessibility = accessibility
        self.screenDigester = screenDigester
        self.sleeper = sleeper
    }

    func currentAXDigest() throws -> String {
        try ObservationDigest.digest(currentObservation())
    }

    func currentFocusedElementIndex() throws -> Int? {
        try currentObservation().elements.first(where: { $0.focused == true })?.index
    }

    func waitForFrontmost(
        _ selector: ComputerApplicationSelector,
        timeoutMs: Int
    ) async throws -> ApplicationView {
        try validateTimeout(timeoutMs)
        let attempts = pollAttempts(timeoutMs)
        for attempt in 0...attempts {
            try Task.checkCancellation()
            if let frontmost = workspace.frontmostApplication(), matches(frontmost, selector: selector) {
                return frontmost.view
            }
            if attempt < attempts {
                try await sleeper.sleep(nanoseconds: Self.pollIntervalNanoseconds)
            }
        }
        throw ComputerVerificationError.focusFailed
    }

    func waitForText(_ text: String, exact: Bool, timeoutMs: Int) async throws {
        try validateTimeout(timeoutMs)
        let attempts = pollAttempts(timeoutMs)
        for attempt in 0...attempts {
            try Task.checkCancellation()
            let observation = try currentObservation()
            if observation.elements.contains(where: { element in
                [element.title, element.description].compactMap { $0 }.contains(where: { candidate in
                    exact ? candidate == text : candidate.contains(text)
                })
            }) {
                return
            }
            if attempt < attempts {
                try await sleeper.sleep(nanoseconds: Self.pollIntervalNanoseconds)
            }
        }
        throw ComputerVerificationError.timeout
    }

    func waitUntilAXChanged(
        from baselineDigest: String,
        timeoutMs: Int
    ) async throws -> String {
        try validateTimeout(timeoutMs)
        let attempts = pollAttempts(timeoutMs)
        for attempt in 0...attempts {
            try Task.checkCancellation()
            let digest = try currentAXDigest()
            if digest != baselineDigest {
                return digest
            }
            if attempt < attempts {
                try await sleeper.sleep(nanoseconds: Self.pollIntervalNanoseconds)
            }
        }
        throw ComputerVerificationError.timeout
    }

    func currentScreenRegionDigest(bounds: ComputerBounds) async throws -> String {
        try await screenDigester.digest(bounds: bounds)
    }

    func waitUntilScreenRegionChanged(
        bounds: ComputerBounds,
        from baselineDigest: String,
        timeoutMs: Int
    ) async throws -> String {
        try validateTimeout(timeoutMs)
        let attempts = pollAttempts(timeoutMs)
        for attempt in 0...attempts {
            try Task.checkCancellation()
            let digest = try await screenDigester.digest(bounds: bounds)
            if digest != baselineDigest {
                return digest
            }
            if attempt < attempts {
                try await sleeper.sleep(nanoseconds: Self.pollIntervalNanoseconds)
            }
        }
        throw ComputerVerificationError.timeout
    }

    private func currentObservation() throws -> ComputerObservation {
        guard let application = workspace.frontmostApplication() else {
            throw ComputerVerificationError.unavailable
        }
        do {
            return try accessibility.observe(for: application, limits: .default)
        } catch {
            throw ComputerVerificationError.unavailable
        }
    }

    private func matches(_ application: WorkspaceApplication, selector: ComputerApplicationSelector) -> Bool {
        if let bundleIdentifier = selector.bundleIdentifier {
            return application.bundleIdentifier == bundleIdentifier
        }
        if let name = selector.name {
            return application.name == name
        }
        return false
    }

    private func validateTimeout(_ timeoutMs: Int) throws {
        guard (50...10_000).contains(timeoutMs) else {
            throw ComputerVerificationError.unavailable
        }
    }

    private func pollAttempts(_ timeoutMs: Int) -> Int {
        max(1, Int(ceil(Double(timeoutMs) / 20.0)))
    }
}
