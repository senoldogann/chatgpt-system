import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class ReadinessTests: XCTestCase {
    func testHealthReturnsPassivePermissionState() async throws {
        let service = ComputerHostService(
            permissions: FakePermissions(accessibility: true, screenCapture: false),
            workspace: FakeWorkspace(apps: [])
        )
        let request = ComputerProtocolRequest(
            protocolVersion: 1,
            requestId: "health-1",
            method: "health",
            params: .object([:])
        )

        let response = await service.handle(request)

        XCTAssertTrue(response.ok)
        let health = try decodeResult(ComputerHealth.self, from: response)
        XCTAssertEqual(health.state, "running")
        XCTAssertTrue(health.accessibilityTrusted)
        XCTAssertFalse(health.screenCaptureAuthorized)
    }
}

private struct FakePermissions: PermissionReading {
    let accessibility: Bool
    let screenCapture: Bool

    func accessibilityTrusted() -> Bool { accessibility }
    func screenCaptureAuthorized() -> Bool { screenCapture }
}

private struct FakeWorkspace: WorkspaceReading {
    let apps: [WorkspaceApplication]

    func runningApplications() -> [WorkspaceApplication] { apps }
    func frontmostApplication() -> WorkspaceApplication? { apps.first(where: \.frontmost) }
}

private func decodeResult<T: Decodable>(_ type: T.Type, from response: ComputerProtocolResponse) throws -> T {
    let result = try XCTUnwrap(response.result)
    let data = try JSONEncoder().encode(result)
    return try JSONDecoder().decode(type, from: data)
}
