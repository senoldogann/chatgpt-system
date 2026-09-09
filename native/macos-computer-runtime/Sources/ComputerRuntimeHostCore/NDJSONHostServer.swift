import ComputerRuntimeCore
import Foundation

public enum NDJSONHostServerError: Error, Equatable {
    case responseTooLarge
}

public struct NDJSONHostServer: Sendable {
    static let maxRequestLineBytes = 262_144
    static let maxResponseBytes = 12_582_912
    private static let readChunkBytes = 4_096

    private let service: ComputerHostService

    public init(service: ComputerHostService) {
        self.service = service
    }

    public func run() async throws {
        var framer = NDJSONFramer(maxLineBytes: Self.maxRequestLineBytes)
        let input = FileHandle.standardInput
        let output = FileHandle.standardOutput

        while true {
            let chunk = try input.read(upToCount: Self.readChunkBytes) ?? Data()
            if chunk.isEmpty {
                try framer.finish()
                return
            }

            let frames = try framer.append(chunk)
            for frame in frames {
                var response = await responseData(for: frame)
                response.append(0x0A)
                try output.write(contentsOf: response)
            }
        }
    }

    func responseData(for frame: Data) async -> Data {
        let response: ComputerProtocolResponse
        do {
            let request = try ComputerProtocolRequest.decodeStrict(from: frame)
            response = await service.handle(request)
        } catch {
            response = .failure(
                requestId: "unknown",
                code: "COMPUTER_PROTOCOL_INVALID",
                message: "Invalid computer runtime request."
            )
        }

        do {
            return try Self.encodeBounded(response: response, maxBytes: Self.maxResponseBytes)
        } catch {
            return Data(#"{"protocolVersion":1,"requestId":"unknown","ok":false,"error":{"code":"COMPUTER_OUTPUT_LIMIT","message":"Computer runtime output exceeded the limit."}}"#.utf8)
        }
    }

    static func encodeBounded(
        response: ComputerProtocolResponse,
        maxBytes: Int
    ) throws -> Data {
        precondition(maxBytes > 0)
        let encoder = JSONEncoder()
        let encoded = try encoder.encode(response)
        guard encoded.count > maxBytes else {
            return encoded
        }

        let fallback = ComputerProtocolResponse.failure(
            requestId: response.requestId,
            code: "COMPUTER_OUTPUT_LIMIT",
            message: "Computer runtime output exceeded the limit."
        )
        let fallbackData = try encoder.encode(fallback)
        guard fallbackData.count <= maxBytes else {
            throw NDJSONHostServerError.responseTooLarge
        }
        return fallbackData
    }
}
