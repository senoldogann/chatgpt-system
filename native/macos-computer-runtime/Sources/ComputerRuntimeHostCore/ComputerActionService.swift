import ComputerRuntimeCore
import Foundation

struct ComputerActionService: ComputerActionHandling, Sendable {
    private let controller: ComputerInputController

    init(controller: ComputerInputController) {
        self.controller = controller
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
                return .failure(
                    requestId: request.requestId,
                    code: "COMPUTER_ACTION_FAILED",
                    message: "Computer action was cancelled."
                )
            } catch {
                return actionFailed(requestId: request.requestId)
            }

        default:
            return nil
        }
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

    private func actionFailed(requestId: String) -> ComputerProtocolResponse {
        .failure(
            requestId: requestId,
            code: "COMPUTER_ACTION_FAILED",
            message: "Computer action failed."
        )
    }
}
