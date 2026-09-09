import XCTest
@testable import ComputerRuntimeCore

final class ProtocolTests: XCTestCase {
    func testStrictRequestAcceptsExactEnvelope() throws {
        let data = Data(#"{"protocolVersion":1,"requestId":"req-1","method":"health","params":{}}"#.utf8)
        let request = try ComputerProtocolRequest.decodeStrict(from: data)
        XCTAssertEqual(request.protocolVersion, 1)
        XCTAssertEqual(request.requestId, "req-1")
        XCTAssertEqual(request.method, "health")
        XCTAssertEqual(request.params, .object([:]))
    }

    func testStrictRequestRejectsUnknownTopLevelField() throws {
        let data = Data(#"{"protocolVersion":1,"requestId":"req-1","method":"health","params":{},"extra":true}"#.utf8)
        XCTAssertThrowsError(try ComputerProtocolRequest.decodeStrict(from: data))
    }

    func testResponseCarriesEitherResultOrError() {
        let ok = ComputerProtocolResponse.success(requestId: "r1", result: .object(["ready": .bool(true)]))
        XCTAssertTrue(ok.ok)
        XCTAssertNotNil(ok.result)
        XCTAssertNil(ok.error)

        let failed = ComputerProtocolResponse.failure(
            requestId: "r2",
            code: "COMPUTER_PROTOCOL_INVALID",
            message: "Invalid computer runtime request."
        )
        XCTAssertFalse(failed.ok)
        XCTAssertNil(failed.result)
        XCTAssertEqual(failed.error?.code, "COMPUTER_PROTOCOL_INVALID")
    }
}
