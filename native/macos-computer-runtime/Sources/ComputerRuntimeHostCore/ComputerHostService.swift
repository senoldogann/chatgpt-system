import ComputerRuntimeCore
import Foundation

public struct ComputerHostService: Sendable {
    private static let protocolVersion = 1
    private static let maxApplications = 128
    private static let maxStructuredTextCharacters = 4_096
    private static let maxScreenshotBytes = 8_388_608

    private let permissions: any PermissionReading
    private let workspace: any WorkspaceReading
    private let accessibility: (any AccessibilityReading)?
    private let screenshot: (any ScreenshotCapturing)?
    private let actions: (any ComputerActionHandling)?
    private let recovery: (any ComputerRecoveryHandling)?

    public init(
        permissions: any PermissionReading,
        workspace: any WorkspaceReading,
        accessibility: (any AccessibilityReading)? = nil,
        screenshot: (any ScreenshotCapturing)? = nil,
        actions: (any ComputerActionHandling)? = nil
    ) {
        self.permissions = permissions
        self.workspace = workspace
        self.accessibility = accessibility
        self.screenshot = screenshot
        self.actions = actions
        self.recovery = nil
    }

    init(
        permissions: any PermissionReading,
        workspace: any WorkspaceReading,
        accessibility: (any AccessibilityReading)? = nil,
        screenshot: (any ScreenshotCapturing)? = nil,
        actions: (any ComputerActionHandling)? = nil,
        recovery: any ComputerRecoveryHandling
    ) {
        self.permissions = permissions
        self.workspace = workspace
        self.accessibility = accessibility
        self.screenshot = screenshot
        self.actions = actions
        self.recovery = recovery
    }

    public static func system() -> ComputerHostService {
        let topology = SystemDisplayTopology()
        let permissions = SystemPermissionReader()
        let workspaceReader = SystemWorkspaceReader()
        let applicationController = SystemWorkspaceController()
        let accessibilityReader = SystemAccessibilityReader()
        let screenshotCapturer = SystemScreenshotCapturer()
        let recovery = ComputerRecoveryEngine(
            permissions: permissions,
            applicationController: applicationController,
            accessibility: accessibilityReader,
            cache: ComputerObservationCache(capacity: 4),
            resolver: ComputerTargetResolver(),
            screenCapture: screenshotCapturer,
            ocr: SystemVisionOCR(),
            displayTopology: topology
        )
        let verification = ComputerVerificationEngine(
            workspace: workspaceReader,
            accessibility: accessibilityReader,
            screenDigester: SystemScreenRegionDigester(),
            sleeper: SystemInputSleeper()
        )
        let safetyCoordinator = InputSafetyCoordinator()
        let takeoverMonitor = SystemTakeoverMonitor(coordinator: safetyCoordinator)
        do {
            try takeoverMonitor.start()
        } catch {
            safetyCoordinator.markMonitorUnavailable()
        }
        let controller = ComputerInputController(
            eventSink: SystemInputEventSink(),
            pointerReader: topology,
            displayTopology: topology,
            sleeper: SystemPointerSleeper(),
            safetyCoordinator: safetyCoordinator
        )
        return .init(
            permissions: permissions,
            workspace: workspaceReader,
            accessibility: accessibilityReader,
            screenshot: screenshotCapturer,
            actions: ComputerActionService(
                controller: controller,
                applicationController: applicationController,
                appSleeper: SystemInputSleeper(),
                takeoverMonitor: takeoverMonitor,
                verification: verification,
                recovery: recovery
            ),
            recovery: recovery
        )
    }

    public func handle(_ request: ComputerProtocolRequest) async -> ComputerProtocolResponse {
        guard request.protocolVersion == Self.protocolVersion else {
            return protocolInvalid(requestId: request.requestId)
        }

        switch request.method {
        case "health":
            guard hasEmptyObjectParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return encodeResult(
                ComputerHealth(
                    state: "running",
                    accessibilityTrusted: permissions.accessibilityTrusted(),
                    screenCaptureAuthorized: permissions.screenCaptureAuthorized(),
                    eventListenAuthorized: permissions.eventListenAuthorized(),
                    eventPostAuthorized: permissions.eventPostAuthorized()
                ),
                requestId: request.requestId
            )

        case "list_apps":
            guard hasEmptyObjectParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            let applications = workspace.runningApplications()
                .prefix(Self.maxApplications)
                .map { safeApplicationView($0.view) }
            return encodeResult(applications, requestId: request.requestId)

        case "active_window":
            guard hasEmptyObjectParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return handleActiveWindow(requestId: request.requestId)

        case "observe":
            guard hasEmptyObjectParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await handleObservation(requestId: request.requestId)

        case "screenshot":
            guard hasEmptyObjectParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await handleScreenshot(requestId: request.requestId)

        case "resolve_target":
            guard let parsed = parseResolveTargetParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await handleResolveTarget(
                parsed.target,
                retryBudget: parsed.retryBudget,
                requestId: request.requestId
            )

        case "resolve_targets":
            guard let parsed = parseResolveTargetsParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await handleResolveTargets(
                parsed.targets,
                retryBudget: parsed.retryBudget,
                requestId: request.requestId
            )

        default:
            if let actions, let response = await actions.handleAction(request) {
                return response
            }
            return protocolInvalid(requestId: request.requestId)
        }
    }

    public func shutdown() async {
        await actions?.shutdown()
    }

    private func handleActiveWindow(requestId: String) -> ComputerProtocolResponse {
        guard permissions.accessibilityTrusted() else {
            return accessibilityPermissionRequired(requestId: requestId)
        }
        guard let application = workspace.frontmostApplication(), let accessibility else {
            return unavailable(requestId: requestId)
        }

        do {
            let view = try accessibility.activeWindow(for: application)
            return encodeResult(safeActiveWindowView(view), requestId: requestId)
        } catch AccessibilityReadError.permissionRequired {
            return accessibilityPermissionRequired(requestId: requestId)
        } catch {
            return unavailable(requestId: requestId)
        }
    }

    private func handleObservation(requestId: String) async -> ComputerProtocolResponse {
        guard permissions.accessibilityTrusted() else {
            return accessibilityPermissionRequired(requestId: requestId)
        }

        let observation: ComputerObservation
        if let recovery {
            do {
                observation = try await recovery.refreshObservation()
            } catch ComputerRecoveryError.permissionRequired {
                return accessibilityPermissionRequired(requestId: requestId)
            } catch {
                return unavailable(requestId: requestId)
            }
        } else {
            guard let application = workspace.frontmostApplication(), let accessibility else {
                return unavailable(requestId: requestId)
            }
            do {
                observation = try accessibility.observe(for: application, limits: .default)
            } catch AccessibilityReadError.permissionRequired {
                return accessibilityPermissionRequired(requestId: requestId)
            } catch {
                return unavailable(requestId: requestId)
            }
        }

        do {
            let safeObservation = sanitizeObservation(observation, limits: .default)
            let digest = try ObservationDigest.digest(safeObservation)
            let digestedObservation = ComputerObservation(
                snapshotId: safeObservation.snapshotId,
                application: safeObservation.application,
                windowTitle: safeObservation.windowTitle,
                elements: safeObservation.elements,
                truncated: safeObservation.truncated,
                digest: digest
            )
            return encodeBoundedObservation(digestedObservation, requestId: requestId)
        } catch {
            return unavailable(requestId: requestId)
        }
    }

    private func handleResolveTarget(
        _ target: ComputerTarget,
        retryBudget: Int,
        requestId: String
    ) async -> ComputerProtocolResponse {
        guard let recovery else { return unavailable(requestId: requestId) }
        do {
            let resolved = try await recovery.resolve(target, retryBudget: retryBudget)
            return encodeResult(resolvedTargetView(resolved), requestId: requestId)
        } catch let error as ComputerRecoveryError {
            return recoveryFailure(error, requestId: requestId)
        } catch is CancellationError {
            return .failure(
                requestId: requestId,
                code: "COMPUTER_ACTION_FAILED",
                message: "Computer action was cancelled."
            )
        } catch {
            return unavailable(requestId: requestId)
        }
    }

    private func handleResolveTargets(
        _ targets: [ComputerTarget],
        retryBudget: Int,
        requestId: String
    ) async -> ComputerProtocolResponse {
        guard let recovery else { return unavailable(requestId: requestId) }
        do {
            let resolved = try await recovery.resolveMany(targets, retryBudget: retryBudget)
            return encodeResult(resolved.map(resolvedTargetView), requestId: requestId)
        } catch let error as ComputerRecoveryError {
            return recoveryFailure(error, requestId: requestId)
        } catch is CancellationError {
            return .failure(
                requestId: requestId,
                code: "COMPUTER_ACTION_FAILED",
                message: "Computer action was cancelled."
            )
        } catch {
            return unavailable(requestId: requestId)
        }
    }

    private func handleScreenshot(requestId: String) async -> ComputerProtocolResponse {
        guard permissions.screenCaptureAuthorized() else {
            return screenCapturePermissionRequired(requestId: requestId)
        }
        guard let screenshot else {
            return unavailable(requestId: requestId)
        }

        do {
            let capture = try await screenshot.captureMainDisplay(maxBytes: Self.maxScreenshotBytes)
            guard capture.width > 0,
                  capture.height > 0,
                  let png = Data(base64Encoded: capture.pngBase64),
                  !png.isEmpty
            else {
                return unavailable(requestId: requestId)
            }
            guard png.count <= Self.maxScreenshotBytes else {
                return outputLimit(requestId: requestId)
            }
            return encodeResult(capture, requestId: requestId)
        } catch ScreenshotCaptureError.outputLimit {
            return outputLimit(requestId: requestId)
        } catch {
            return unavailable(requestId: requestId)
        }
    }

    private func sanitizeObservation(
        _ observation: ComputerObservation,
        limits: ObservationLimits
    ) -> ComputerObservation {
        let boundedElements = observation.elements
            .prefix(limits.maxElements)
            .map { element in
                ComputerElementView(
                    index: element.index,
                    role: boundedText(element.role) ?? "",
                    subrole: boundedText(element.subrole),
                    title: boundedText(element.title),
                    description: boundedText(element.description),
                    focused: element.focused,
                    enabled: element.enabled,
                    selected: element.selected,
                    bounds: element.bounds
                )
            }

        return ComputerObservation(
            snapshotId: boundedText(observation.snapshotId) ?? "",
            application: safeApplicationView(observation.application),
            windowTitle: boundedText(observation.windowTitle),
            elements: Array(boundedElements),
            truncated: observation.truncated || observation.elements.count > limits.maxElements
        )
    }

    private func encodeBoundedObservation(
        _ observation: ComputerObservation,
        requestId: String
    ) -> ComputerProtocolResponse {
        do {
            let data = try JSONEncoder().encode(observation)
            let serializedCharacters = String(decoding: data, as: UTF8.self).count
            guard serializedCharacters <= ObservationLimits.default.maxSerializedCharacters else {
                return outputLimit(requestId: requestId)
            }
            let result = try JSONDecoder().decode(JSONValue.self, from: data)
            return .success(requestId: requestId, result: result)
        } catch {
            return outputLimit(requestId: requestId)
        }
    }

    private func parseResolveTargetParams(
        _ params: JSONValue
    ) -> (target: ComputerTarget, retryBudget: Int)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["target", "retryBudget"].contains($0) }),
              let rawTarget = object["target"],
              let target = parseTarget(rawTarget),
              let retryBudget = parseRetryBudget(object["retryBudget"])
        else { return nil }
        return (target, retryBudget)
    }

    private func parseResolveTargetsParams(
        _ params: JSONValue
    ) -> (targets: [ComputerTarget], retryBudget: Int)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["targets", "retryBudget"].contains($0) }),
              case let .array(rawTargets)? = object["targets"],
              !rawTargets.isEmpty,
              rawTargets.count <= 100,
              let retryBudget = parseRetryBudget(object["retryBudget"])
        else { return nil }

        var targets: [ComputerTarget] = []
        targets.reserveCapacity(rawTargets.count)
        for rawTarget in rawTargets {
            guard let target = parseTarget(rawTarget) else { return nil }
            targets.append(target)
        }
        return (targets, retryBudget)
    }

    private func parseRetryBudget(_ value: JSONValue?) -> Int? {
        guard let value else { return 2 }
        guard case let .number(raw) = value,
              raw.isFinite,
              raw.rounded(.towardZero) == raw,
              raw >= 0,
              raw <= 2
        else { return nil }
        return Int(raw)
    }

    private func parseTarget(_ value: JSONValue) -> ComputerTarget? {
        guard case let .object(object) = value,
              case let .string(kind)? = object["by"]
        else { return nil }

        switch kind {
        case "index":
            guard Set(object.keys).isSubset(of: ["by", "snapshotId", "index"]),
                  case let .string(snapshotId)? = object["snapshotId"],
                  isValidTargetString(snapshotId),
                  case let .number(rawIndex)? = object["index"],
                  rawIndex.isFinite, rawIndex.rounded(.towardZero) == rawIndex, rawIndex >= 0,
                  rawIndex <= Double(Int.max)
            else { return nil }
            return .index(snapshotId: snapshotId, index: Int(rawIndex))

        case "role":
            guard Set(object.keys).isSubset(of: ["by", "role", "name", "exact"]),
                  case let .string(role)? = object["role"],
                  isValidTargetString(role),
                  let exact = parseOptionalExact(object["exact"])
            else { return nil }
            let name: String?
            if let rawName = object["name"] {
                guard case let .string(value) = rawName, isValidTargetString(value) else { return nil }
                name = value
            } else {
                name = nil
            }
            return .role(role: role, name: name, exact: exact)

        case "text", "ocrText", "label":
            let textKey = kind == "label" ? "label" : "text"
            guard Set(object.keys).isSubset(of: ["by", textKey, "exact"]),
                  case let .string(text)? = object[textKey],
                  isValidTargetString(text),
                  let exact = parseOptionalExact(object["exact"])
            else { return nil }
            switch kind {
            case "text": return .text(text: text, exact: exact)
            case "ocrText": return .ocrText(text: text, exact: exact)
            default: return .label(label: text, exact: exact)
            }

        case "point":
            guard Set(object.keys) == Set(["by", "x", "y"]),
                  case let .number(x)? = object["x"],
                  case let .number(y)? = object["y"],
                  x.isFinite, y.isFinite
            else { return nil }
            return .point(x: x, y: y)

        default:
            return nil
        }
    }

    private func parseOptionalExact(_ value: JSONValue?) -> Bool? {
        guard let value else { return false }
        guard case let .bool(exact) = value else { return nil }
        return exact
    }

    private func isValidTargetString(_ value: String) -> Bool {
        !value.isEmpty && value.count <= Self.maxStructuredTextCharacters
    }

    private func resolvedTargetView(_ resolved: ResolvedComputerTarget) -> ComputerResolvedTargetView {
        ComputerResolvedTargetView(
            source: resolved.source,
            bounds: resolved.bounds,
            actionPoint: resolved.actionPoint,
            observationId: resolved.observationId,
            confidence: resolved.confidence
        )
    }

    private func safeActiveWindowView(_ view: ActiveWindowView) -> ActiveWindowView {
        ActiveWindowView(
            application: safeApplicationView(view.application),
            title: boundedText(view.title)
        )
    }

    private func safeApplicationView(_ view: ApplicationView) -> ApplicationView {
        ApplicationView(
            name: boundedText(view.name) ?? "",
            bundleIdentifier: boundedText(view.bundleIdentifier),
            frontmost: view.frontmost
        )
    }

    private func boundedText(_ value: String?) -> String? {
        guard let value else { return nil }
        return String(value.prefix(Self.maxStructuredTextCharacters))
    }

    private func encodeResult<T: Encodable>(_ value: T, requestId: String) -> ComputerProtocolResponse {
        do {
            return .success(requestId: requestId, result: try JSONValue.fromEncodable(value))
        } catch {
            return outputLimit(requestId: requestId)
        }
    }

    private func protocolInvalid(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_PROTOCOL_INVALID",
            message: "Invalid computer runtime request."
        )
    }

    private func accessibilityPermissionRequired(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_PERMISSION_REQUIRED",
            message: "Accessibility permission is required."
        )
    }

    private func screenCapturePermissionRequired(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_PERMISSION_REQUIRED",
            message: "Screen Recording permission is required."
        )
    }

    private func recoveryFailure(
        _ error: ComputerRecoveryError,
        requestId: String
    ) -> ComputerProtocolResponse {
        switch error {
        case .invalidRetryBudget:
            return protocolInvalid(requestId: requestId)
        case .targetNotFound:
            return .failure(requestId: requestId, code: "COMPUTER_TARGET_NOT_FOUND", message: "Computer target was not found.")
        case .targetAmbiguous:
            return .failure(requestId: requestId, code: "COMPUTER_TARGET_AMBIGUOUS", message: "Computer target is ambiguous.")
        case .staleSnapshot:
            return .failure(requestId: requestId, code: "COMPUTER_STALE_SNAPSHOT", message: "Computer target snapshot is stale.")
        case .unsafeGeometry:
            return .failure(requestId: requestId, code: "COMPUTER_ACTION_FAILED", message: "Computer target geometry is unsafe.")
        case .focusFailed:
            return .failure(requestId: requestId, code: "COMPUTER_FOCUS_FAILED", message: "Computer focus verification failed.")
        case .permissionRequired:
            return .failure(requestId: requestId, code: "COMPUTER_PERMISSION_REQUIRED", message: "Computer permission is required.")
        case .unavailable:
            return unavailable(requestId: requestId)
        case .needsReplan:
            return .failure(requestId: requestId, code: "COMPUTER_NEEDS_REPLAN", message: "Computer state requires replanning.")
        }
    }

    private func unavailable(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_UNAVAILABLE",
            message: "Computer runtime is unavailable."
        )
    }

    private func outputLimit(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_OUTPUT_LIMIT",
            message: "Computer runtime output exceeded the limit."
        )
    }

    private func hasEmptyObjectParams(_ params: JSONValue) -> Bool {
        guard case let .object(object) = params else {
            return false
        }
        return object.isEmpty
    }
}
