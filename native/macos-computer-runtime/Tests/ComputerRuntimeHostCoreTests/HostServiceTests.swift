import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class HostServiceTests: XCTestCase {
    func testRejectsUnsupportedProtocolVersion() async {
        let service = makeHostService()
        let response = await service.handle(.init(
            protocolVersion: 2,
            requestId: "bad-version",
            method: "health",
            params: .object([:])
        ))

        assertProtocolInvalid(response)
    }

    func testRejectsUnknownMethod() async {
        let service = makeHostService()
        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "bad-method",
            method: "unknown",
            params: .object([:])
        ))

        assertProtocolInvalid(response)
    }

    func testHealthRejectsNonEmptyParams() async {
        let service = makeHostService()
        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "health-params",
            method: "health",
            params: .object(["unexpected": .bool(true)])
        ))

        assertProtocolInvalid(response)
    }

    func testListAppsRejectsNonEmptyParams() async {
        let service = makeHostService()
        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "apps-params",
            method: "list_apps",
            params: .object(["unexpected": .string("value")])
        ))

        assertProtocolInvalid(response)
    }

    func testHealthRejectsNonObjectParams() async {
        let service = makeHostService()
        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "health-array-params",
            method: "health",
            params: .array([])
        ))

        assertProtocolInvalid(response)
    }

    func testMalformedFrameProducesGenericUnknownRequestError() async throws {
        let server = NDJSONHostServer(service: makeHostService())

        let data = await server.responseData(for: Data("{not-json}".utf8))
        let response = try JSONDecoder().decode(ComputerProtocolResponse.self, from: data)

        assertProtocolInvalid(response)
        XCTAssertEqual(response.requestId, "unknown")
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(text.contains("not-json"))
        XCTAssertFalse(text.localizedCaseInsensitiveContains("decod"))
    }

    func testResponseEncoderReplacesOversizedPayloadWithStableLimitError() throws {
        let response = ComputerProtocolResponse.success(
            requestId: "large",
            result: .object(["payload": .string(String(repeating: "x", count: 2_000))])
        )

        let data = try NDJSONHostServer.encodeBounded(response: response, maxBytes: 256)
        let bounded = try JSONDecoder().decode(ComputerProtocolResponse.self, from: data)

        XCTAssertLessThanOrEqual(data.count, 256)
        XCTAssertFalse(bounded.ok)
        XCTAssertEqual(bounded.requestId, "large")
        XCTAssertEqual(bounded.error?.code, "COMPUTER_OUTPUT_LIMIT")
        XCTAssertEqual(bounded.error?.message, "Computer runtime output exceeded the limit.")
    }

    func testServerUsesFixedProtocolBounds() {
        XCTAssertEqual(NDJSONHostServer.maxRequestLineBytes, 262_144)
        XCTAssertEqual(NDJSONHostServer.maxResponseBytes, 12_582_912)
    }
}

private struct HostFakePermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { false }
    func screenCaptureAuthorized() -> Bool { false }
}

private struct HostFakeWorkspace: WorkspaceReading {
    func runningApplications() -> [WorkspaceApplication] { [] }
    func frontmostApplication() -> WorkspaceApplication? { nil }
}

private func makeHostService() -> ComputerHostService {
    ComputerHostService(permissions: HostFakePermissions(), workspace: HostFakeWorkspace())
}

private func assertProtocolInvalid(
    _ response: ComputerProtocolResponse,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    XCTAssertFalse(response.ok, file: file, line: line)
    XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID", file: file, line: line)
    XCTAssertEqual(response.error?.message, "Invalid computer runtime request.", file: file, line: line)
    XCTAssertNil(response.error?.details, file: file, line: line)
}
