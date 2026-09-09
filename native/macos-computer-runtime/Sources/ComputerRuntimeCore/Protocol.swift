import Foundation

public enum ComputerProtocolDecodingError: Error, Equatable {
    case invalidEnvelope
}

public struct ComputerProtocolRequest: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let requestId: String
    public let method: String
    public let params: JSONValue

    public init(protocolVersion: Int, requestId: String, method: String, params: JSONValue) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.method = method
        self.params = params
    }

    public static func decodeStrict(from data: Data) throws -> ComputerProtocolRequest {
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
        guard case let .object(object) = decoded,
              Set(object.keys) == Set(["protocolVersion", "requestId", "method", "params"])
        else {
            throw ComputerProtocolDecodingError.invalidEnvelope
        }
        return try JSONDecoder().decode(ComputerProtocolRequest.self, from: data)
    }
}

public struct ComputerProtocolError: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
    public let details: JSONValue?

    public init(code: String, message: String, details: JSONValue? = nil) {
        self.code = code
        self.message = message
        self.details = details
    }
}

public struct ComputerProtocolResponse: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let requestId: String
    public let ok: Bool
    public let result: JSONValue?
    public let error: ComputerProtocolError?

    public init(
        protocolVersion: Int,
        requestId: String,
        ok: Bool,
        result: JSONValue?,
        error: ComputerProtocolError?
    ) {
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.ok = ok
        self.result = result
        self.error = error
    }

    public static func success(requestId: String, result: JSONValue) -> Self {
        .init(protocolVersion: 1, requestId: requestId, ok: true, result: result, error: nil)
    }

    public static func failure(
        requestId: String,
        code: String,
        message: String,
        details: JSONValue? = nil
    ) -> Self {
        .init(
            protocolVersion: 1,
            requestId: requestId,
            ok: false,
            result: nil,
            error: .init(code: code, message: message, details: details)
        )
    }
}
