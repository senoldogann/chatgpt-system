import ComputerRuntimeCore
import CryptoKit
import Foundation

public enum ComputerRecoveryError: Error, Equatable, Sendable {
    case invalidRetryBudget
    case targetNotFound
    case targetAmbiguous
    case staleSnapshot
    case unsafeGeometry
    case focusFailed
    case permissionRequired
    case unavailable
    case needsReplan
}

actor ComputerRecoveryEngine: ComputerRecoveryHandling {
    private let permissions: any PermissionReading
    private let applicationController: any ApplicationControlling
    private let accessibility: any AccessibilityReading
    private let cache: any ComputerObservationCaching
    private let resolver: ComputerTargetResolver
    private let screenCapture: any ScreenImageCapturing
    private let ocr: any VisionTextRecognizing
    private let displayTopology: any DisplayTopologyReading

    private var lastObservation: CachedComputerObservation?
    private var lastWindowIdentity: String?
    private var lastWindowGeneration: String?

    init(
        permissions: any PermissionReading,
        applicationController: any ApplicationControlling,
        accessibility: any AccessibilityReading,
        cache: any ComputerObservationCaching,
        resolver: ComputerTargetResolver,
        screenCapture: any ScreenImageCapturing,
        ocr: any VisionTextRecognizing,
        displayTopology: any DisplayTopologyReading
    ) {
        self.permissions = permissions
        self.applicationController = applicationController
        self.accessibility = accessibility
        self.cache = cache
        self.resolver = resolver
        self.screenCapture = screenCapture
        self.ocr = ocr
        self.displayTopology = displayTopology
    }

    func resolve(
        _ target: ComputerTarget,
        retryBudget: Int = 2
    ) async throws -> ResolvedComputerTarget {
        guard (0...2).contains(retryBudget) else {
            throw ComputerRecoveryError.invalidRetryBudget
        }
        guard permissions.accessibilityTrusted() else {
            throw ComputerRecoveryError.permissionRequired
        }

        let priorIndexedObservation = priorObservation(for: target)
        if let priorIndexedObservation {
            try await refocusPriorApplicationIfNeeded(priorIndexedObservation)
        }
        let recoveryTarget = semanticRecoveryTarget(for: target, prior: priorIndexedObservation) ?? target

        var context: ComputerTargetResolutionContext
        var usedCachedContext = false
        if let cached = try compatibleCachedContext() {
            context = cached
            usedCachedContext = true
        } else {
            context = try freshContext()
        }

        do {
            return try resolver.resolve(target: target, in: context)
        } catch let error as ComputerTargetResolutionError {
            if retryBudget == 0 {
                throw mapResolutionError(error)
            }
        }

        if usedCachedContext {
            context = try freshContext()
        }
        do {
            return try resolver.resolve(target: recoveryTarget, in: context)
        } catch let error as ComputerTargetResolutionError {
            if retryBudget <= 1 {
                throw mapResolutionError(error)
            }
        }

        if let ocrResolved = try await resolveWithOCRIfRelevant(
            target: recoveryTarget,
            context: context
        ) {
            return ocrResolved
        }

        throw ComputerRecoveryError.needsReplan
    }

    func resolveMany(
        _ targets: [ComputerTarget],
        retryBudget: Int = 2
    ) async throws -> [ResolvedComputerTarget] {
        guard !targets.isEmpty, targets.count <= 100 else {
            throw ComputerRecoveryError.invalidRetryBudget
        }
        var resolved: [ResolvedComputerTarget] = []
        resolved.reserveCapacity(targets.count)
        for target in targets {
            resolved.append(try await resolve(target, retryBudget: retryBudget))
        }
        return resolved
    }

    func refreshObservation() async throws -> ComputerObservation {
        try freshContext().cached.observation
    }

    private func priorObservation(for target: ComputerTarget) -> CachedComputerObservation? {
        guard case let .index(snapshotId, _) = target else { return nil }
        return cache.observation(snapshotId: snapshotId)
    }

    private func semanticRecoveryTarget(
        for target: ComputerTarget,
        prior: CachedComputerObservation?
    ) -> ComputerTarget? {
        guard case let .index(_, index) = target,
              let prior,
              let element = prior.observation.elements.first(where: { $0.index == index })
        else {
            return target
        }
        if let title = element.title, !title.isEmpty {
            return .role(role: element.role, name: title, exact: true)
        }
        if let description = element.description, !description.isEmpty {
            return .role(role: element.role, name: description, exact: true)
        }
        return .role(role: element.role, name: nil, exact: true)
    }

    private func refocusPriorApplicationIfNeeded(
        _ prior: CachedComputerObservation
    ) async throws {
        if let current = applicationController.frontmostApplication(),
           Self.appIdentity(for: current) == prior.appIdentity
        {
            return
        }
        guard let intended = applicationController.runningApplications().first(where: {
            Self.appIdentity(for: $0) == prior.appIdentity
        }) else {
            throw ComputerRecoveryError.focusFailed
        }
        guard await applicationController.activate(intended),
              let current = applicationController.frontmostApplication(),
              Self.appIdentity(for: current) == prior.appIdentity
        else {
            throw ComputerRecoveryError.focusFailed
        }
    }

    private func compatibleCachedContext() throws -> ComputerTargetResolutionContext? {
        guard let lastObservation,
              let application = applicationController.frontmostApplication()
        else {
            return nil
        }
        let appIdentity = Self.appIdentity(for: application)
        guard appIdentity == lastObservation.appIdentity else { return nil }

        let activeWindow: ActiveWindowView
        do {
            activeWindow = try accessibility.activeWindow(for: application)
        } catch AccessibilityReadError.permissionRequired {
            throw ComputerRecoveryError.permissionRequired
        } catch {
            return nil
        }
        let windowIdentity = Self.windowIdentity(
            appIdentity: appIdentity,
            title: activeWindow.title
        )
        guard windowIdentity == lastObservation.windowIdentity else { return nil }

        let displays = try activeDisplays()
        let topologyDigest = Self.topologyDigest(displays)
        guard topologyDigest == lastObservation.displayTopologyDigest,
              let cached = cache.current(
                appIdentity: appIdentity,
                windowIdentity: windowIdentity,
                windowGeneration: lastObservation.windowGeneration,
                displayTopologyDigest: topologyDigest
              )
        else {
            return nil
        }
        return ComputerTargetResolutionContext(
            cached: cached,
            currentDisplayTopologyDigest: topologyDigest,
            activeDisplays: displays
        )
    }

    private func freshContext() throws -> ComputerTargetResolutionContext {
        guard permissions.accessibilityTrusted() else {
            throw ComputerRecoveryError.permissionRequired
        }
        guard let application = applicationController.frontmostApplication() else {
            throw ComputerRecoveryError.unavailable
        }

        let appIdentity = Self.appIdentity(for: application)
        let activeWindow: ActiveWindowView
        do {
            activeWindow = try accessibility.activeWindow(for: application)
        } catch AccessibilityReadError.permissionRequired {
            throw ComputerRecoveryError.permissionRequired
        } catch {
            throw ComputerRecoveryError.unavailable
        }
        let windowIdentity = Self.windowIdentity(
            appIdentity: appIdentity,
            title: activeWindow.title
        )
        let generation = windowGeneration(for: windowIdentity)
        let displays = try activeDisplays()
        let topologyDigest = Self.topologyDigest(displays)

        let rawObservation: ComputerObservation
        do {
            rawObservation = try accessibility.observe(for: application, limits: .default)
        } catch AccessibilityReadError.permissionRequired {
            throw ComputerRecoveryError.permissionRequired
        } catch {
            throw ComputerRecoveryError.unavailable
        }

        let observation: ComputerObservation
        do {
            let digest = try ObservationDigest.digest(rawObservation)
            observation = ComputerObservation(
                snapshotId: rawObservation.snapshotId,
                application: rawObservation.application,
                windowTitle: rawObservation.windowTitle,
                elements: rawObservation.elements,
                truncated: rawObservation.truncated,
                digest: digest
            )
        } catch {
            throw ComputerRecoveryError.unavailable
        }

        let previousOCRUsefulness: OCRUsefulness
        if let lastObservation,
           lastObservation.windowGeneration == generation
        {
            previousOCRUsefulness = lastObservation.capability.ocrUseful
        } else {
            previousOCRUsefulness = .unknown
        }
        let profile = PerceptionCapabilityProfile(
            axQuality: Self.axQuality(for: observation),
            ocrUseful: previousOCRUsefulness,
            lastObservationMonotonicMs: ProcessInfo.processInfo.systemUptime * 1_000,
            windowGeneration: generation
        )
        let cached = CachedComputerObservation(
            observationId: observation.snapshotId,
            createdMonotonicMs: ProcessInfo.processInfo.systemUptime * 1_000,
            appIdentity: appIdentity,
            windowIdentity: windowIdentity,
            windowGeneration: generation,
            displayTopologyDigest: topologyDigest,
            observation: observation,
            capability: profile
        )
        cache.store(cached)
        lastObservation = cached

        return ComputerTargetResolutionContext(
            cached: cached,
            currentDisplayTopologyDigest: topologyDigest,
            activeDisplays: displays
        )
    }

    private func resolveWithOCRIfRelevant(
        target: ComputerTarget,
        context: ComputerTargetResolutionContext
    ) async throws -> ResolvedComputerTarget? {
        guard let query = Self.ocrQuery(for: target) else { return nil }
        guard permissions.screenCaptureAuthorized() else {
            throw ComputerRecoveryError.permissionRequired
        }

        let capture: ScreenImageCapture
        do {
            capture = try await screenCapture.captureMainDisplayImage()
        } catch {
            throw ComputerRecoveryError.unavailable
        }

        let fast: [OcrTextCandidate]
        do {
            fast = try await ocr.recognizeText(in: capture.image, mode: .fast)
        } catch {
            throw ComputerRecoveryError.unavailable
        }
        if let resolved = try resolveOCRCandidates(
            fast,
            query: query,
            capture: capture,
            context: context
        ) {
            updateOCRUsefulness(.yes, context: context)
            return resolved
        }

        let accurate: [OcrTextCandidate]
        do {
            accurate = try await ocr.recognizeText(in: capture.image, mode: .accurate)
        } catch {
            throw ComputerRecoveryError.unavailable
        }
        if let resolved = try resolveOCRCandidates(
            accurate,
            query: query,
            capture: capture,
            context: context
        ) {
            updateOCRUsefulness(.yes, context: context)
            return resolved
        }

        updateOCRUsefulness(.no, context: context)
        return nil
    }

    private func resolveOCRCandidates(
        _ candidates: [OcrTextCandidate],
        query: (text: String, exact: Bool),
        capture: ScreenImageCapture,
        context: ComputerTargetResolutionContext
    ) throws -> ResolvedComputerTarget? {
        let matching = candidates.filter { candidate in
            guard candidate.confidence.map({ $0 >= 0.5 }) ?? true else { return false }
            return Self.matchesText(candidate.text, query: query.text, exact: query.exact)
        }
        guard !matching.isEmpty else { return nil }
        guard matching.count == 1, let candidate = matching.first else {
            return nil
        }
        guard let screenBounds = Self.screenBounds(
            for: candidate.bounds,
            imageWidth: capture.image.width,
            imageHeight: capture.image.height,
            captureBounds: capture.screenBounds
        ) else {
            return nil
        }

        let actionPoint = ComputerPoint(
            x: screenBounds.x + screenBounds.width / 2,
            y: screenBounds.y + screenBounds.height / 2
        )
        return ResolvedComputerTarget(
            source: .ocr,
            bounds: screenBounds,
            actionPoint: actionPoint,
            observationId: candidate.observationId,
            appIdentity: context.cached.appIdentity,
            windowIdentity: context.cached.windowIdentity,
            windowGeneration: context.cached.windowGeneration,
            displayTopologyDigest: context.currentDisplayTopologyDigest,
            confidence: .high,
            semanticFingerprint: Self.hash(
                "\(Self.normalized(query.text, lowercased: true))\u{1f}\(screenBounds.x),\(screenBounds.y),\(screenBounds.width),\(screenBounds.height)"
            )
        )
    }

    private func updateOCRUsefulness(
        _ usefulness: OCRUsefulness,
        context: ComputerTargetResolutionContext
    ) {
        let profile = PerceptionCapabilityProfile(
            axQuality: context.cached.capability.axQuality,
            ocrUseful: usefulness,
            lastObservationMonotonicMs: ProcessInfo.processInfo.systemUptime * 1_000,
            windowGeneration: context.cached.windowGeneration
        )
        cache.updateCapability(
            appIdentity: context.cached.appIdentity,
            windowIdentity: context.cached.windowIdentity,
            windowGeneration: context.cached.windowGeneration,
            capability: profile
        )
        if let current = lastObservation,
           current.windowGeneration == context.cached.windowGeneration,
           current.windowIdentity == context.cached.windowIdentity
        {
            lastObservation = current.replacingCapability(profile)
        }
    }

    private func activeDisplays() throws -> [ComputerBounds] {
        do {
            let displays = try displayTopology.activeDisplayBounds()
            guard !displays.isEmpty else { throw ComputerRecoveryError.unavailable }
            return displays
        } catch let error as ComputerRecoveryError {
            throw error
        } catch {
            throw ComputerRecoveryError.unavailable
        }
    }

    private func windowGeneration(for identity: String) -> String {
        if lastWindowIdentity == identity, let lastWindowGeneration {
            return lastWindowGeneration
        }
        let generation = UUID().uuidString
        lastWindowIdentity = identity
        lastWindowGeneration = generation
        return generation
    }

    private func mapResolutionError(_ error: ComputerTargetResolutionError) -> ComputerRecoveryError {
        switch error {
        case .notFound:
            return .targetNotFound
        case .ambiguous:
            return .targetAmbiguous
        case .staleSnapshot:
            return .staleSnapshot
        case .unsafeGeometry:
            return .unsafeGeometry
        }
    }

    private static func appIdentity(for application: WorkspaceApplication) -> String {
        if let bundleIdentifier = application.bundleIdentifier, !bundleIdentifier.isEmpty {
            return bundleIdentifier
        }
        return "name-\(hash(application.name))"
    }

    private static func windowIdentity(appIdentity: String, title: String?) -> String {
        hash("\(appIdentity)\u{1f}\(title ?? "")")
    }

    private static func topologyDigest(_ displays: [ComputerBounds]) -> String {
        let payload = displays
            .sorted { lhs, rhs in
                if lhs.x != rhs.x { return lhs.x < rhs.x }
                if lhs.y != rhs.y { return lhs.y < rhs.y }
                if lhs.width != rhs.width { return lhs.width < rhs.width }
                return lhs.height < rhs.height
            }
            .map { "\($0.x),\($0.y),\($0.width),\($0.height)" }
            .joined(separator: "\u{1e}")
        return hash(payload)
    }

    private static func axQuality(for observation: ComputerObservation) -> AXQuality {
        if observation.elements.isEmpty { return .weak }
        if observation.truncated { return .partial }
        return .strong
    }

    private static func ocrQuery(for target: ComputerTarget) -> (text: String, exact: Bool)? {
        switch target {
        case let .text(text, exact), let .ocrText(text, exact):
            return (text, exact)
        default:
            return nil
        }
    }

    private static func matchesText(_ candidate: String, query: String, exact: Bool) -> Bool {
        let normalizedQuery = normalized(query, lowercased: !exact)
        let normalizedCandidate = normalized(candidate, lowercased: !exact)
        guard !normalizedQuery.isEmpty, !normalizedCandidate.isEmpty else { return false }
        return exact ? normalizedCandidate == normalizedQuery : normalizedCandidate.contains(normalizedQuery)
    }

    private static func normalized(_ value: String, lowercased: Bool) -> String {
        let collapsed = value
            .prefix(4_096)
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        return lowercased ? collapsed.lowercased() : collapsed
    }

    private static func screenBounds(
        for imageBounds: ComputerBounds,
        imageWidth: Int,
        imageHeight: Int,
        captureBounds: ComputerBounds
    ) -> ComputerBounds? {
        guard imageWidth > 0,
              imageHeight > 0,
              imageBounds.x.isFinite,
              imageBounds.y.isFinite,
              imageBounds.width.isFinite,
              imageBounds.height.isFinite,
              imageBounds.x >= 0,
              imageBounds.y >= 0,
              imageBounds.width > 0,
              imageBounds.height > 0,
              imageBounds.x + imageBounds.width <= Double(imageWidth),
              imageBounds.y + imageBounds.height <= Double(imageHeight),
              captureBounds.width > 0,
              captureBounds.height > 0
        else {
            return nil
        }

        let scaleX = captureBounds.width / Double(imageWidth)
        let scaleY = captureBounds.height / Double(imageHeight)
        return ComputerBounds(
            x: captureBounds.x + imageBounds.x * scaleX,
            y: captureBounds.y + imageBounds.y * scaleY,
            width: imageBounds.width * scaleX,
            height: imageBounds.height * scaleY
        )
    }

    private static func hash(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
