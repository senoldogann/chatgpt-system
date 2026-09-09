import ComputerRuntimeCore
import Foundation

public struct ComputerHostService: Sendable {
    private static let protocolVersion = 1
    private static let maxApplications = 128

    private let permissions: any PermissionReading
    private let workspace: any WorkspaceReading

    public init(permissions: any PermissionReading, workspace: any WorkspaceReading) {
        self.permissions = permissions
        self.workspace = workspace
    }

    public static func system() -> ComputerHostService {
        .init(permissions: SystemPermissionReader(), workspace: SystemWorkspaceReader())
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
                .map { application in
                    ApplicationView(
                        name: boundedText(application.name) ?? "",
                        bundleIdentifier: boundedText(application.bundleIdentifier),
                        frontmost: application.frontmost
                    )
                }
            return encodeResult(applications, requestId: request.requestId)

        default:
            return protocolInvalid(requestId: request.requestId)
        }
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

    private func hasEmptyObjectParams(_ params: JSONValue) -> Bool {
        guard case let .object(object) = params else {
            return false
        }
        return object.isEmpty
    }
}
