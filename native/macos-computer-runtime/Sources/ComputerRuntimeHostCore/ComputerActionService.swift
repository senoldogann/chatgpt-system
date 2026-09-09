import ComputerRuntimeCore
import Foundation

private enum ApplicationResolutionError: Error {
    case notFound
    case ambiguous
}

struct ComputerActionService: ComputerActionHandling, Sendable {
    private static let maxSelectorCharacters = 4_096
    private static let defaultFocusTimeoutMs = 1_500
    private static let focusPollIntervalMs = 20

    private let controller: ComputerInputController
    private let applicationController: (any ApplicationControlling)?
    private let appSleeper: any InputSleeping

    init(
        controller: ComputerInputController,
        applicationController: (any ApplicationControlling)? = nil,
        appSleeper: any InputSleeping = SystemInputSleeper()
    ) {
        self.controller = controller
        self.applicationController = applicationController
        self.appSleeper = appSleeper
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
            do {
                let result = try await controller.moveMouse(to: parsed.point, mode: parsed.mode)
                return encodeResult(result, requestId: request.requestId)
            } catch is CancellationError {
                return cancelled(requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "click", "double_click":
            guard let parsed = parseClickParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                let result = request.method == "click"
                    ? try await controller.click(at: parsed.point, button: parsed.button, mode: parsed.mode)
                    : try await controller.doubleClick(at: parsed.point, button: parsed.button, mode: parsed.mode)
                return encodeResult(result, requestId: request.requestId)
            } catch is CancellationError {
                return cancelled(requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "mouse_down", "mouse_up":
            guard let button = parseButtonOnlyParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                let result = request.method == "mouse_down"
                    ? try await controller.mouseDown(button)
                    : try await controller.mouseUp(button)
                return encodeResult(result, requestId: request.requestId)
            } catch is CancellationError {
                return cancelled(requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "drag":
            guard let parsed = parseDragParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                let result = try await controller.drag(
                    from: parsed.from,
                    to: parsed.to,
                    button: parsed.button,
                    mode: parsed.mode
                )
                return encodeResult(result, requestId: request.requestId)
            } catch is CancellationError {
                return cancelled(requestId: request.requestId)
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        case "scroll":
            guard let parsed = parseScrollParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            do {
                let result = try await controller.scroll(
                    vertical: parsed.vertical,
                    horizontal: parsed.horizontal,
                    at: parsed.point,
                    mode: parsed.mode
                )
                return encodeResult(result, requestId: request.requestId)
            } catch is CancellationError {
                return cancelled(requestId: request.requestId)
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

            guard applicationController.activate(application) else {
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
        for attempt in 0...attempts {
            try Task.checkCancellation()
            if let frontmost = applicationController.frontmostApplication(),
               matches(frontmost, target: target, selector: selector)
            {
                return frontmost
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
    ) -> (point: ComputerPoint, button: ComputerMouseButton, mode: PointerMotionMode)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["x", "y", "button", "motionMode"].contains($0) }),
              let point = parsePointObject(object),
              let button = parseMouseButton(object["button"]),
              let mode = parseMotionMode(object["motionMode"])
        else {
            return nil
        }
        return (point, button, mode)
    }

    private func parseButtonOnlyParams(_ params: JSONValue) -> ComputerMouseButton? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ $0 == "button" })
        else {
            return nil
        }
        return parseMouseButton(object["button"])
    }

    private func parseDragParams(
        _ params: JSONValue
    ) -> (from: ComputerPoint, to: ComputerPoint, button: ComputerMouseButton, mode: PointerMotionMode)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["from", "to", "button", "motionMode"].contains($0) }),
              let rawFrom = object["from"],
              let rawTo = object["to"],
              let from = parseNestedPoint(rawFrom),
              let to = parseNestedPoint(rawTo),
              let button = parseMouseButton(object["button"]),
              let mode = parseMotionMode(object["motionMode"])
        else {
            return nil
        }
        return (from, to, button, mode)
    }

    private func parseScrollParams(
        _ params: JSONValue
    ) -> (vertical: Int32, horizontal: Int32, point: ComputerPoint?, mode: PointerMotionMode)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["vertical", "horizontal", "x", "y", "motionMode"].contains($0) }),
              let vertical = parseScrollDelta(object["vertical"]),
              let horizontal = parseScrollDelta(object["horizontal"]),
              let mode = parseMotionMode(object["motionMode"])
        else {
            return nil
        }

        let hasX = object["x"] != nil
        let hasY = object["y"] != nil
        guard hasX == hasY else { return nil }
        let point: ComputerPoint?
        if hasX {
            guard let parsed = parsePointObject(object) else { return nil }
            point = parsed
        } else {
            point = nil
        }
        return (vertical, horizontal, point, mode)
    }

    private func parseNestedPoint(_ value: JSONValue) -> ComputerPoint? {
        guard case let .object(object) = value,
              Set(object.keys) == Set(["x", "y"])
        else {
            return nil
        }
        return parsePointObject(object)
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

    private func parseMoveMouseParams(_ params: JSONValue) -> (point: ComputerPoint, mode: PointerMotionMode)? {
        guard case let .object(object) = params,
              object.keys.allSatisfy({ ["x", "y", "motionMode"].contains($0) }),
              case let .number(x)? = object["x"],
              case let .number(y)? = object["y"],
              x.isFinite,
              y.isFinite
        else {
            return nil
        }

        let mode: PointerMotionMode
        if let rawMode = object["motionMode"] {
            guard case let .string(value) = rawMode,
                  let parsed = PointerMotionMode(rawValue: value)
            else {
                return nil
            }
            mode = parsed
        } else {
            mode = .fast
        }

        return (ComputerPoint(x: x, y: y), mode)
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
