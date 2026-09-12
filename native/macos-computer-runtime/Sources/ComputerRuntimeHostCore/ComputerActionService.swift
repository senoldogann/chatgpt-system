import ComputerRuntimeCore
import Foundation

private enum ApplicationResolutionError: Error {
    case notFound
    case ambiguous
}

private enum ActionVerificationSpec: Sendable {
    case axChanged(timeoutMs: Int)
    case textAppeared(text: String, exact: Bool, timeoutMs: Int)
    case screenRegionChanged(bounds: ComputerBounds, timeoutMs: Int)
}

private enum ActionPointSpec: Sendable {
    case point(ComputerPoint)
    case target(ComputerTarget, retryBudget: Int)

    var isSemantic: Bool {
        if case .target = self { return true }
        return false
    }
}

private struct ApplicationInputFocusGuard: InputFocusGuard {
    let applicationController: any ApplicationControlling
    let target: WorkspaceApplication
    let selector: ComputerApplicationSelector

    func verifyExpectedFrontmost() async throws {
        guard let frontmost = applicationController.frontmostApplication() else {
            throw ComputerInputError.focusMismatch
        }
        if let bundleIdentifier = selector.bundleIdentifier {
            guard frontmost.bundleIdentifier == bundleIdentifier else {
                throw ComputerInputError.focusMismatch
            }
        } else {
            guard frontmost.processIdentifier == target.processIdentifier else {
                throw ComputerInputError.focusMismatch
            }
        }
    }
}

struct ComputerActionService: ComputerActionHandling, Sendable {
    private static let maxSelectorCharacters = 4_096
    private static let maxTypedCharacters = 16_384
    private static let defaultFocusTimeoutMs = 1_500
    private static let focusPollIntervalMs = 20

    private let controller: ComputerInputController
    private let applicationController: (any ApplicationControlling)?
    private let appSleeper: any InputSleeping
    private let takeoverMonitor: (any TakeoverMonitoring)?
    private let verification: (any ComputerVerificationHandling)?
    private let recovery: (any ComputerRecoveryHandling)?

    init(
        controller: ComputerInputController,
        applicationController: (any ApplicationControlling)? = nil,
        appSleeper: any InputSleeping = SystemInputSleeper(),
        takeoverMonitor: (any TakeoverMonitoring)? = nil,
        verification: (any ComputerVerificationHandling)? = nil,
        recovery: (any ComputerRecoveryHandling)? = nil
    ) {
        self.controller = controller
        self.applicationController = applicationController
        self.appSleeper = appSleeper
        self.takeoverMonitor = takeoverMonitor
        self.verification = verification
        self.recovery = recovery
    }

    func handleAction(_ request: ComputerProtocolRequest) async -> ComputerProtocolResponse? {
        switch request.method {
        case "pointer_position":
            guard case let .object(params) = request.params, params.isEmpty else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                return encodeResult(try controller.pointerPosition(), requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "move_mouse":
            guard let parsed = parseMoveMouseParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await executeVerifiedAction(
                verificationSpec: parsed.verification,
                requestId: request.requestId
            ) {
                let point = try await resolveActionPoint(parsed.point)
                return try await controller.moveMouse(to: point, mode: parsed.mode)
            }

        case "click", "double_click":
            guard let parsed = parseClickParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await executeVerifiedAction(verificationSpec: parsed.verification, requestId: request.requestId) {
                let point = try await resolveActionPoint(parsed.point)
                return request.method == "click"
                    ? try await controller.click(at: point, button: parsed.button, mode: parsed.mode)
                    : try await controller.doubleClick(at: point, button: parsed.button, mode: parsed.mode)
            }

        case "mouse_down", "mouse_up":
            guard let parsed = parseButtonOnlyParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await executeVerifiedAction(verificationSpec: parsed.verification, requestId: request.requestId) {
                request.method == "mouse_down"
                    ? try await controller.mouseDown(parsed.button)
                    : try await controller.mouseUp(parsed.button)
            }

        case "drag":
            guard let parsed = parseDragParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await executeVerifiedAction(verificationSpec: parsed.verification, requestId: request.requestId) {
                let endpoints = try await resolveDragEndpoints(from: parsed.from, to: parsed.to)
                return try await controller.drag(
                    from: endpoints.from,
                    to: endpoints.to,
                    button: parsed.button,
                    mode: parsed.mode
                )
            }

        case "scroll":
            guard let parsed = parseScrollParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await executeVerifiedAction(verificationSpec: parsed.verification, requestId: request.requestId) {
                let point = try await resolveOptionalActionPoint(parsed.point)
                return try await controller.scroll(
                    vertical: parsed.vertical,
                    horizontal: parsed.horizontal,
                    at: point,
                    mode: parsed.mode
                )
            }

        case "type_text":
            guard let parsed = parseTypeTextParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await handleKeyboardAction(
                selector: parsed.selector,
                verificationSpec: parsed.verification,
                requestId: request.requestId
            ) { focusGuard in
                try await controller.typeText(parsed.text, focusGuard: focusGuard)
            }

        case "press_key":
            guard let parsed = parsePressKeyParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await handleKeyboardAction(
                selector: parsed.selector,
                verificationSpec: parsed.verification,
                requestId: request.requestId
            ) { focusGuard in
                try await controller.pressKey(
                    named: parsed.key,
                    modifiers: parsed.modifiers,
                    focusGuard: focusGuard
                )
            }

        case "wait_for_frontmost":
            guard let parsed = parseWaitForFrontmostParams(request.params), let verification else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                let result = try await verification.waitForFrontmost(parsed.selector, timeoutMs: parsed.timeoutMs)
                return encodeResult(result, requestId: request.requestId)
            } catch ComputerVerificationError.focusFailed {
                return focusFailed(requestId: request.requestId)
            } catch ComputerVerificationError.timeout {
                return timeout(requestId: request.requestId)
            } catch is CancellationError {
                return cancelled(requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "wait_for_text":
            guard let parsed = parseWaitForTextParams(request.params), let verification else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                try await verification.waitForText(parsed.text, exact: parsed.exact, timeoutMs: parsed.timeoutMs)
                return encodeResult(ComputerActionResult(state: "completed"), requestId: request.requestId)
            } catch ComputerVerificationError.timeout {
                return timeout(requestId: request.requestId)
            } catch is CancellationError {
                return cancelled(requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "wait_until_changed":
            guard let parsed = parseWaitUntilChangedParams(request.params), let verification else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                let digest = try await verification.waitUntilAXChanged(from: parsed.baselineDigest, timeoutMs: parsed.timeoutMs)
                return .success(requestId: request.requestId, result: .object(["digest": .string(digest)]))
            } catch ComputerVerificationError.timeout {
                return timeout(requestId: request.requestId)
            } catch is CancellationError {
                return cancelled(requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "release_inputs":
            guard case let .object(params) = request.params, params.isEmpty else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                try await controller.releaseAllInputs()
                return encodeResult(ComputerActionResult(state: "completed"), requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "focus_app", "open_app":
            guard let parsed = parseApplicationParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await handleApplicationAction(
                method: request.method,
                selector: parsed.selector,
                timeoutMs: parsed.timeoutMs,
                requestId: request.requestId
            )

        default:
            return nil
        }
    }

    func shutdown() async {
        try? await controller.releaseAllInputs()
        takeoverMonitor?.stop()
    }

    private func resolveActionPoint(_ spec: ActionPointSpec) async throws -> ComputerPoint {
        switch spec {
        case let .point(point):
            return point
        case let .target(target, retryBudget):
            guard let recovery else { throw ComputerRecoveryError.unavailable }
            let resolved = try await recovery.resolve(target, retryBudget: retryBudget)
            return resolved.actionPoint
        }
    }

    private func resolveOptionalActionPoint(_ spec: ActionPointSpec?) async throws -> ComputerPoint? {
        guard let spec else { return nil }
        return try await resolveActionPoint(spec)
    }

    private func resolveDragEndpoints(
        from: ActionPointSpec,
        to: ActionPointSpec
    ) async throws -> (from: ComputerPoint, to: ComputerPoint) {
        if case let .target(fromTarget, fromBudget) = from,
           case let .target(toTarget, toBudget) = to,
           fromBudget == toBudget
        {
            guard let recovery else { throw ComputerRecoveryError.unavailable }
            let resolved = try await recovery.resolveMany([fromTarget, toTarget], retryBudget: fromBudget)
            guard resolved.count == 2 else { throw ComputerRecoveryError.unavailable }
            return (resolved[0].actionPoint, resolved[1].actionPoint)
        }
        return (try await resolveActionPoint(from), try await resolveActionPoint(to))
    }

    private func executeVerifiedAction(
        verificationSpec: ActionVerificationSpec?,
        requestId: String,
        action: () async throws -> ComputerActionResult
    ) async -> ComputerProtocolResponse {
        do {
            let baseline = try await captureVerificationBaseline(verificationSpec)
            let result = try await action()
            try await waitForVerification(verificationSpec, baseline: baseline)
            return encodeResult(result, requestId: requestId)
        } catch let error as ComputerRecoveryError {
            await releaseInputsAfterFailedAction()
            return recoveryFailed(error, requestId: requestId)
        } catch ComputerVerificationError.timeout {
            await releaseInputsAfterFailedAction()
            return timeout(requestId: requestId)
        } catch ComputerInputError.focusMismatch {
            await releaseInputsAfterFailedAction()
            return focusFailed(requestId: requestId)
        } catch is InputSafetyInterruption {
            await releaseInputsAfterFailedAction()
            return userTakeover(requestId: requestId)
        } catch is CancellationError {
            await releaseInputsAfterFailedAction()
            return cancelled(requestId: requestId)
        } catch {
            await releaseInputsAfterFailedAction()
            return actionFailed(requestId: requestId)
        }
    }

    private func releaseInputsAfterFailedAction() async {
        try? await controller.releaseAllInputs()
    }

    private func captureVerificationBaseline(_ spec: ActionVerificationSpec?) async throws -> String? {
        guard let spec else { return nil }
        guard let verification else { throw ComputerVerificationError.unavailable }
        switch spec {
        case .axChanged:
            return try verification.currentAXDigest()
        case .textAppeared:
            return nil
        case let .screenRegionChanged(bounds, _):
            return try await verification.currentScreenRegionDigest(bounds: bounds)
        }
    }

    private func waitForVerification(_ spec: ActionVerificationSpec?, baseline: String?) async throws {
        guard let spec else { return }
        guard let verification else { throw ComputerVerificationError.unavailable }
        switch spec {
        case let .axChanged(timeoutMs):
            guard let baseline else { throw ComputerVerificationError.unavailable }
            _ = try await verification.waitUntilAXChanged(from: baseline, timeoutMs: timeoutMs)
        case let .textAppeared(text, exact, timeoutMs):
            try await verification.waitForText(text, exact: exact, timeoutMs: timeoutMs)
        case let .screenRegionChanged(bounds, timeoutMs):
            guard let baseline else { throw ComputerVerificationError.unavailable }
            _ = try await verification.waitUntilScreenRegionChanged(
                bounds: bounds, from: baseline, timeoutMs: timeoutMs
            )
        }
    }

    private func handleKeyboardAction(
        selector: ComputerApplicationSelector,
        verificationSpec: ActionVerificationSpec?,
        requestId: String,
        action: (any InputFocusGuard) async throws -> ComputerActionResult
    ) async -> ComputerProtocolResponse {
        guard let applicationController else {
            return actionFailed(requestId: requestId)
        }
        do {
            let target = try resolveRunning(selector, using: applicationController)
            let focusGuard = ApplicationInputFocusGuard(
                applicationController: applicationController,
                target: target,
                selector: selector
            )
            return await executeVerifiedAction(verificationSpec: verificationSpec, requestId: requestId) {
                try await action(focusGuard)
            }
        } catch ApplicationResolutionError.notFound {
            return targetNotFound(requestId: requestId)
        } catch ApplicationResolutionError.ambiguous {
            return targetAmbiguous(requestId: requestId)
        } catch ComputerInputError.focusMismatch {
            return focusFailed(requestId: requestId)
        } catch is InputSafetyInterruption {
            return userTakeover(requestId: requestId)
        } catch is CancellationError {
            return cancelled(requestId: requestId)
        } catch {
            return actionFailed(requestId: requestId)
        }
    }

    private func handleApplicationAction(
        method: String,
        selector: ComputerApplicationSelector,
        timeoutMs: Int,
        requestId: String
    ) async -> ComputerProtocolResponse {
        guard let applicationController else {
            return actionFailed(requestId: requestId)
        }

        do {
            let application: WorkspaceApplication
            if method == "open_app" {
                application = try await resolveOrOpen(selector, using: applicationController)
            } else {
                application = try resolveRunning(selector, using: applicationController)
            }

            if let frontmost = applicationController.frontmostApplication(),
               matches(frontmost, target: application, selector: selector)
            {
                return encodeResult(safeApplicationView(frontmost), requestId: requestId)
            }

            guard await applicationController.activate(application) else {
                return focusFailed(requestId: requestId)
            }

            guard let frontmost = try await waitForFrontmost(
                target: application,
                selector: selector,
                timeoutMs: timeoutMs,
                using: applicationController
            ) else {
                return focusFailed(requestId: requestId)
            }

            return encodeResult(safeApplicationView(frontmost), requestId: requestId)
        } catch ApplicationResolutionError.notFound {
            return targetNotFound(requestId: requestId)
        } catch ApplicationResolutionError.ambiguous {
            return targetAmbiguous(requestId: requestId)
        } catch is CancellationError {
            return cancelled(requestId: requestId)
        } catch {
            return actionFailed(requestId: requestId)
        }
    }

    private func resolveRunning(
        _ selector: ComputerApplicationSelector,
        using applicationController: any ApplicationControlling
    ) throws -> WorkspaceApplication {
        let applications = applicationController.runningApplications()

        if let bundleIdentifier = selector.bundleIdentifier {
            let matches = applications
                .filter { $0.bundleIdentifier == bundleIdentifier }
                .sorted { $0.processIdentifier < $1.processIdentifier }
            guard let match = matches.first else {
                throw ApplicationResolutionError.notFound
            }
            return match
        }

        guard let name = selector.name else {
            throw ApplicationResolutionError.notFound
        }
        let matches = applications.filter { $0.name == name }
        guard !matches.isEmpty else {
            throw ApplicationResolutionError.notFound
        }
        guard matches.count == 1, let match = matches.first else {
            throw ApplicationResolutionError.ambiguous
        }
        return match
    }

    private func resolveOrOpen(
        _ selector: ComputerApplicationSelector,
        using applicationController: any ApplicationControlling
    ) async throws -> WorkspaceApplication {
        if let bundleIdentifier = selector.bundleIdentifier {
            let running = applicationController.runningApplications()
                .filter { $0.bundleIdentifier == bundleIdentifier }
                .sorted { $0.processIdentifier < $1.processIdentifier }
            if let existing = running.first {
                return existing
            }
            guard let url = applicationController.applicationURL(bundleIdentifier: bundleIdentifier) else {
                throw ApplicationResolutionError.notFound
            }
            return try await applicationController.openApplication(at: url)
        }

        return try resolveRunning(selector, using: applicationController)
    }

    private func waitForFrontmost(
        target: WorkspaceApplication,
        selector: ComputerApplicationSelector,
        timeoutMs: Int,
        using applicationController: any ApplicationControlling
    ) async throws -> WorkspaceApplication? {
        let attempts = max(1, Int(ceil(Double(timeoutMs) / Double(Self.focusPollIntervalMs))))
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .milliseconds(timeoutMs))
        for attempt in 0...attempts {
            try Task.checkCancellation()
            if attempt > 0, clock.now >= deadline {
                return nil
            }
            if let frontmost = applicationController.frontmostApplication(),
               matches(frontmost, target: target, selector: selector)
            {
                return frontmost
            }
            if clock.now >= deadline {
                return nil
            }
            if attempt < attempts {
                try await appSleeper.sleep(nanoseconds: UInt64(Self.focusPollIntervalMs) * 1_000_000)
            }
        }
        return nil
    }

    private func matches(
        _ frontmost: WorkspaceApplication,
        target: WorkspaceApplication,
        selector: ComputerApplicationSelector
    ) -> Bool {
        if let bundleIdentifier = selector.bundleIdentifier {
            return frontmost.bundleIdentifier == bundleIdentifier
        }
        return frontmost.processIdentifier == target.processIdentifier
    }

    private func parseClickParams(
        _ params: JSONValue
    ) -> (point: ActionPointSpec, button: ComputerMouseButton, mode: PointerMotionMode, verification: ActionVerificationSpec?)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["x", "y", "target", "retryBudget", "button", "motionMode", "verify"].contains($0) }),
              let point = parseActionPointSpec(object),
              let button = parseMouseButton(object["button"]),
              let mode = parseMotionMode(object["motionMode"]),
              let verification = parseOptionalVerification(object["verify"])
        else { return nil }
        return (point, button, mode, verification)
    }

    private func parseButtonOnlyParams(
        _ params: JSONValue
    ) -> (button: ComputerMouseButton, verification: ActionVerificationSpec?)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["button", "verify"].contains($0) }),
              let button = parseMouseButton(object["button"]),
              let verification = parseOptionalVerification(object["verify"])
        else {
            return nil
        }
        return (button, verification)
    }

    private func parseDragParams(
        _ params: JSONValue
    ) -> (from: ActionPointSpec, to: ActionPointSpec, button: ComputerMouseButton, mode: PointerMotionMode, verification: ActionVerificationSpec?)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["from", "to", "retryBudget", "button", "motionMode", "verify"].contains($0) }),
              let rawFrom = object["from"],
              let rawTo = object["to"],
              let retryBudget = parseRetryBudget(object["retryBudget"]),
              let from = parseDragEndpoint(rawFrom, retryBudget: retryBudget),
              let to = parseDragEndpoint(rawTo, retryBudget: retryBudget),
              let button = parseMouseButton(object["button"]),
              let mode = parseMotionMode(object["motionMode"]),
              let verification = parseOptionalVerification(object["verify"])
        else { return nil }
        if !from.isSemantic && !to.isSemantic && object["retryBudget"] != nil { return nil }
        return (from, to, button, mode, verification)
    }

    private func parseScrollParams(
        _ params: JSONValue
    ) -> (vertical: Int32, horizontal: Int32, point: ActionPointSpec?, mode: PointerMotionMode, verification: ActionVerificationSpec?)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["vertical", "horizontal", "x", "y", "target", "retryBudget", "motionMode", "verify"].contains($0) }),
              let vertical = parseScrollDelta(object["vertical"]),
              let horizontal = parseScrollDelta(object["horizontal"]),
              let mode = parseMotionMode(object["motionMode"]),
              let verification = parseOptionalVerification(object["verify"])
        else { return nil }

        let hasCoordinates = object["x"] != nil || object["y"] != nil
        let hasTarget = object["target"] != nil
        guard !(hasCoordinates && hasTarget) else { return nil }

        let point: ActionPointSpec?
        if hasCoordinates || hasTarget {
            guard let parsed = parseActionPointSpec(object) else { return nil }
            point = parsed
        } else {
            guard object["retryBudget"] == nil else { return nil }
            point = nil
        }
        return (vertical, horizontal, point, mode, verification)
    }

    private func parsePointObject(_ object: [String: JSONValue]) -> ComputerPoint? {
        guard case let .number(x)? = object["x"],
              case let .number(y)? = object["y"],
              x.isFinite,
              y.isFinite
        else {
            return nil
        }
        return ComputerPoint(x: x, y: y)
    }

    private func parseActionPointSpec(_ object: [String: JSONValue]) -> ActionPointSpec? {
        let hasX = object["x"] != nil
        let hasY = object["y"] != nil
        let hasTarget = object["target"] != nil
        guard hasX == hasY, !(hasX && hasTarget) else { return nil }

        if hasX {
            guard object["retryBudget"] == nil, let point = parsePointObject(object) else { return nil }
            return .point(point)
        }
        guard hasTarget,
              let rawTarget = object["target"],
              let target = parseTarget(rawTarget),
              let retryBudget = parseRetryBudget(object["retryBudget"])
        else { return nil }
        return .target(target, retryBudget: retryBudget)
    }

    private func parseDragEndpoint(_ value: JSONValue, retryBudget: Int) -> ActionPointSpec? {
        guard case let .object(object) = value else { return nil }
        if Set(object.keys) == Set(["x", "y"]), let point = parsePointObject(object) {
            return .point(point)
        }
        guard let target = parseTarget(value) else { return nil }
        return .target(target, retryBudget: retryBudget)
    }

    private func parseRetryBudget(_ value: JSONValue?) -> Int? {
        guard let value else { return 2 }
        guard case let .number(raw) = value,
              raw.isFinite,
              raw.rounded(.towardZero) == raw,
              raw >= 0, raw <= 2
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
                  isValidSelectorString(snapshotId),
                  case let .number(rawIndex)? = object["index"],
                  rawIndex.isFinite, rawIndex.rounded(.towardZero) == rawIndex,
                  rawIndex >= 0, rawIndex <= Double(Int.max)
            else { return nil }
            return .index(snapshotId: snapshotId, index: Int(rawIndex))

        case "role":
            guard Set(object.keys).isSubset(of: ["by", "role", "name", "exact"]),
                  case let .string(role)? = object["role"],
                  isValidSelectorString(role),
                  let exact = parseExact(object["exact"])
            else { return nil }
            let name: String?
            if let rawName = object["name"] {
                guard case let .string(value) = rawName, isValidSelectorString(value) else { return nil }
                name = value
            } else {
                name = nil
            }
            return .role(role: role, name: name, exact: exact)

        case "text", "ocrText", "label":
            let key = kind == "label" ? "label" : "text"
            guard Set(object.keys).isSubset(of: ["by", key, "exact"]),
                  case let .string(text)? = object[key],
                  isValidSelectorString(text),
                  let exact = parseExact(object["exact"])
            else { return nil }
            if kind == "text" { return .text(text: text, exact: exact) }
            if kind == "ocrText" { return .ocrText(text: text, exact: exact) }
            return .label(label: text, exact: exact)

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

    private func parseExact(_ value: JSONValue?) -> Bool? {
        guard let value else { return false }
        guard case let .bool(exact) = value else { return nil }
        return exact
    }

    private func parseMouseButton(_ value: JSONValue?) -> ComputerMouseButton? {
        guard let value else { return .left }
        guard case let .string(raw) = value else { return nil }
        return ComputerMouseButton(rawValue: raw)
    }

    private func parseMotionMode(_ value: JSONValue?) -> PointerMotionMode? {
        guard let value else { return .fast }
        guard case let .string(raw) = value else { return nil }
        return PointerMotionMode(rawValue: raw)
    }

    private func parseScrollDelta(_ value: JSONValue?) -> Int32? {
        guard case let .number(raw)? = value,
              raw.isFinite,
              raw.rounded(.towardZero) == raw,
              raw >= -10_000,
              raw <= 10_000
        else {
            return nil
        }
        return Int32(raw)
    }

    private func parseOptionalVerification(_ value: JSONValue?) -> ActionVerificationSpec?? {
        guard let value else { return .some(nil) }
        guard case let .object(object) = value,
              case let .string(kind)? = object["kind"],
              let timeoutMs = parseVerificationTimeout(object["timeoutMs"])
        else {
            return nil
        }
        switch kind {
        case "ax_changed":
            guard object.keys.allSatisfy({ ["kind", "timeoutMs"].contains($0) }) else { return nil }
            return .some(.axChanged(timeoutMs: timeoutMs))
        case "text_appeared":
            guard object.keys.allSatisfy({ ["kind", "text", "exact", "timeoutMs"].contains($0) }),
                  case let .string(text)? = object["text"],
                  !text.isEmpty, text.count <= Self.maxSelectorCharacters
            else { return nil }
            let exact: Bool
            if let rawExact = object["exact"] {
                guard case let .bool(value) = rawExact else { return nil }
                exact = value
            } else {
                exact = false
            }
            return .some(.textAppeared(text: text, exact: exact, timeoutMs: timeoutMs))
        case "screen_region_changed":
            guard object.keys.allSatisfy({ ["kind", "x", "y", "width", "height", "timeoutMs"].contains($0) }),
                  case let .number(x)? = object["x"],
                  case let .number(y)? = object["y"],
                  case let .number(width)? = object["width"],
                  case let .number(height)? = object["height"],
                  x.isFinite, y.isFinite, width.isFinite, height.isFinite,
                  width > 0, height > 0
            else { return nil }
            return .some(.screenRegionChanged(
                bounds: ComputerBounds(x: x, y: y, width: width, height: height),
                timeoutMs: timeoutMs
            ))
        default:
            return nil
        }
    }

    private func parseWaitForFrontmostParams(
        _ params: JSONValue
    ) -> (selector: ComputerApplicationSelector, timeoutMs: Int)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["bundleIdentifier", "name", "timeoutMs"].contains($0) }),
              let selector = parseRequiredSelector(object),
              let timeoutMs = parseVerificationTimeout(object["timeoutMs"])
        else {
            return nil
        }
        return (selector, timeoutMs)
    }

    private func parseWaitForTextParams(
        _ params: JSONValue
    ) -> (text: String, exact: Bool, timeoutMs: Int)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["text", "exact", "timeoutMs"].contains($0) }),
              case let .string(text)? = object["text"],
              !text.isEmpty,
              text.count <= Self.maxSelectorCharacters,
              let timeoutMs = parseVerificationTimeout(object["timeoutMs"])
        else {
            return nil
        }
        let exact: Bool
        if let rawExact = object["exact"] {
            guard case let .bool(value) = rawExact else { return nil }
            exact = value
        } else {
            exact = false
        }
        return (text, exact, timeoutMs)
    }

    private func parseWaitUntilChangedParams(
        _ params: JSONValue
    ) -> (baselineDigest: String, timeoutMs: Int)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["baselineDigest", "timeoutMs"].contains($0) }),
              case let .string(baselineDigest)? = object["baselineDigest"],
              !baselineDigest.isEmpty,
              baselineDigest.count <= Self.maxSelectorCharacters,
              let timeoutMs = parseVerificationTimeout(object["timeoutMs"])
        else {
            return nil
        }
        return (baselineDigest, timeoutMs)
    }

    private func parseVerificationTimeout(_ value: JSONValue?) -> Int? {
        guard let value else { return 2_000 }
        guard case let .number(raw) = value,
              raw.isFinite,
              raw.rounded(.towardZero) == raw,
              raw >= 50,
              raw <= 10_000
        else {
            return nil
        }
        return Int(raw)
    }

    private func parseTypeTextParams(
        _ params: JSONValue
    ) -> (text: String, selector: ComputerApplicationSelector, verification: ActionVerificationSpec?)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["text", "bundleIdentifier", "name", "verify"].contains($0) }),
              case let .string(text)? = object["text"],
              text.count <= Self.maxTypedCharacters,
              let selector = parseRequiredSelector(object),
              let verification = parseOptionalVerification(object["verify"])
        else {
            return nil
        }
        return (text, selector, verification)
    }

    private func parsePressKeyParams(
        _ params: JSONValue
    ) -> (key: String, modifiers: Set<ComputerKeyModifier>, selector: ComputerApplicationSelector, verification: ActionVerificationSpec?)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["key", "modifiers", "bundleIdentifier", "name", "verify"].contains($0) }),
              case let .string(key)? = object["key"],
              KeyMapping.keyCode(for: key) != nil,
              let selector = parseRequiredSelector(object),
              let verification = parseOptionalVerification(object["verify"])
        else {
            return nil
        }

        var modifiers: Set<ComputerKeyModifier> = []
        if let rawModifiers = object["modifiers"] {
            guard case let .array(values) = rawModifiers else { return nil }
            for value in values {
                guard case let .string(raw) = value,
                      let modifier = ComputerKeyModifier(rawValue: raw),
                      modifiers.insert(modifier).inserted
                else {
                    return nil
                }
            }
        }
        return (key, modifiers, selector, verification)
    }

    private func parseRequiredSelector(_ object: [String: JSONValue]) -> ComputerApplicationSelector? {
        let bundleIdentifier: String?
        if let raw = object["bundleIdentifier"] {
            guard case let .string(value) = raw, isValidSelectorString(value) else { return nil }
            bundleIdentifier = value
        } else {
            bundleIdentifier = nil
        }

        let name: String?
        if let raw = object["name"] {
            guard case let .string(value) = raw, isValidSelectorString(value) else { return nil }
            name = value
        } else {
            name = nil
        }

        guard bundleIdentifier != nil || name != nil else { return nil }
        return ComputerApplicationSelector(bundleIdentifier: bundleIdentifier, name: name)
    }

    private func parseApplicationParams(
        _ params: JSONValue
    ) -> (selector: ComputerApplicationSelector, timeoutMs: Int)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["bundleIdentifier", "name", "timeoutMs"].contains($0) })
        else {
            return nil
        }

        let bundleIdentifier: String?
        if let raw = object["bundleIdentifier"] {
            guard case let .string(value) = raw, isValidSelectorString(value) else { return nil }
            bundleIdentifier = value
        } else {
            bundleIdentifier = nil
        }

        let name: String?
        if let raw = object["name"] {
            guard case let .string(value) = raw, isValidSelectorString(value) else { return nil }
            name = value
        } else {
            name = nil
        }

        guard bundleIdentifier != nil || name != nil else {
            return nil
        }

        let timeoutMs: Int
        if let raw = object["timeoutMs"] {
            guard case let .number(value) = raw,
                  value.isFinite,
                  value.rounded(.towardZero) == value,
                  value >= 50,
                  value <= 5_000
            else {
                return nil
            }
            timeoutMs = Int(value)
        } else {
            timeoutMs = Self.defaultFocusTimeoutMs
        }

        return (
            ComputerApplicationSelector(bundleIdentifier: bundleIdentifier, name: name),
            timeoutMs
        )
    }

    private func isValidSelectorString(_ value: String) -> Bool {
        !value.isEmpty && value.count <= Self.maxSelectorCharacters
    }

    private func parseMoveMouseParams(
        _ params: JSONValue
    ) -> (point: ActionPointSpec, mode: PointerMotionMode, verification: ActionVerificationSpec?)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["x", "y", "target", "retryBudget", "motionMode", "verify"].contains($0) }),
              let point = parseActionPointSpec(object),
              let mode = parseMotionMode(object["motionMode"]),
              let verification = parseOptionalVerification(object["verify"])
        else { return nil }
        return (point, mode, verification)
    }

    private func safeApplicationView(_ application: WorkspaceApplication) -> ApplicationView {
        ApplicationView(
            name: String(application.name.prefix(Self.maxSelectorCharacters)),
            bundleIdentifier: application.bundleIdentifier.map {
                String($0.prefix(Self.maxSelectorCharacters))
            },
            frontmost: true
        )
    }

    private func encodeResult<T: Encodable>(_ value: T, requestId: String) -> ComputerProtocolResponse {
        do {
            return .success(requestId: requestId, result: try JSONValue.fromEncodable(value))
        } catch {
            return .failure(
                requestId: requestId,
                code: "COMPUTER_OUTPUT_LIMIT",
                message: "Computer runtime output exceeded the limit."
            )
        }
    }

    private func recoveryFailed(_ error: ComputerRecoveryError, requestId: String) -> ComputerProtocolResponse {
        switch error {
        case .invalidRetryBudget:
            return protocolInvalid(requestId: requestId)
        case .targetNotFound:
            return targetNotFound(requestId: requestId)
        case .targetAmbiguous:
            return targetAmbiguous(requestId: requestId)
        case .staleSnapshot:
            return .failure(
                requestId: requestId,
                code: "COMPUTER_STALE_SNAPSHOT",
                message: "Computer target snapshot is stale."
            )
        case .unsafeGeometry, .unavailable:
            return actionFailed(requestId: requestId)
        case .focusFailed:
            return focusFailed(requestId: requestId)
        case .permissionRequired:
            return .failure(
                requestId: requestId,
                code: "COMPUTER_PERMISSION_REQUIRED",
                message: "Computer permission is required."
            )
        case .needsReplan:
            return .failure(
                requestId: requestId,
                code: "COMPUTER_NEEDS_REPLAN",
                message: "Computer state requires replanning."
            )
        }
    }

    private func protocolInvalid(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_PROTOCOL_INVALID",
            message: "Invalid computer runtime request."
        )
    }

    private func targetNotFound(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_TARGET_NOT_FOUND",
            message: "Computer target was not found."
        )
    }

    private func targetAmbiguous(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_TARGET_AMBIGUOUS",
            message: "Computer target is ambiguous."
        )
    }

    private func focusFailed(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_FOCUS_FAILED",
            message: "Computer focus verification failed."
        )
    }

    private func timeout(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_TIMEOUT",
            message: "Computer verification timed out."
        )
    }

    private func userTakeover(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_USER_TAKEOVER",
            message: "User took over computer input."
        )
    }

    private func cancelled(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_ACTION_FAILED",
            message: "Computer action was cancelled."
        )
    }

    private func actionFailed(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_ACTION_FAILED",
            message: "Computer action failed."
        )
    }
}
