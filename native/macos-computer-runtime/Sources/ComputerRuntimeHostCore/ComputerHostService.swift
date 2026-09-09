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
    }

    public static func system() -> ComputerHostService {
        let topology = SystemDisplayTopology()
        let controller = ComputerInputController(
            eventSink: SystemInputEventSink(),
            pointerReader: topology,
            displayTopology: topology,
            sleeper: SystemInputSleeper()
        )
        return .init(
            permissions: SystemPermissionReader(),
            workspace: SystemWorkspaceReader(),
            accessibility: SystemAccessibilityReader(),
            screenshot: SystemScreenshotCapturer(),
            actions: ComputerActionService(controller: controller)
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
                    screenCaptureAuthorized: permissions.screenCaptureAuthorized()
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
            return handleObservation(requestId: request.requestId)

        case "screenshot":
            guard hasEmptyObjectParams(request.params) else {
                return protocolInvalid(requestId: request.requestId)
            }
            return await handleScreenshot(requestId: request.requestId)

        default:
            if let actions, let response = await actions.handleAction(request) {
                return response
            }
            return protocolInvalid(requestId: request.requestId)
        }
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

    private func handleObservation(requestId: String) -> ComputerProtocolResponse {
        guard permissions.accessibilityTrusted() else {
            return accessibilityPermissionRequired(requestId: requestId)
        }
        guard let application = workspace.frontmostApplication(), let accessibility else {
            return unavailable(requestId: requestId)
        }

        do {
            let observation = try accessibility.observe(for: application, limits: .default)
            let safeObservation = sanitizeObservation(observation, limits: .default)
            return encodeBoundedObservation(safeObservation, requestId: requestId)
        } catch AccessibilityReadError.permissionRequired {
            return accessibilityPermissionRequired(requestId: requestId)
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
