import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class WorkspaceTests: XCTestCase {
    func testListAppsIsBoundedAndRedacted() async throws {
        let apps = (0..<140).map { index in
            WorkspaceApplication(
                processIdentifier: Int32(index + 100),
                name: "App-\(String(format: "%03d", index))",
                bundleIdentifier: "com.example.app\(index)",
                frontmost: index == 0
            )
        }
        let service = ComputerHostService(
            permissions: WorkspaceFakePermissions(),
            workspace: WorkspaceFakeWorkspace(apps: apps)
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "apps-1",
            method: "list_apps",
            params: .object([:])
        ))

        XCTAssertTrue(response.ok)
        let views = try decodeWorkspaceResult([ApplicationView].self, from: response)
        XCTAssertEqual(views.count, 128)

        let encoded = try JSONEncoder().encode(response)
        let text = String(decoding: encoded, as: UTF8.self)
        XCTAssertFalse(text.contains("processIdentifier"))
        XCTAssertFalse(text.contains("\"pid\""))
    }

    func testListAppsBoundsNameAndBundleIdentifier() async throws {
        let longName = String(repeating: "n", count: 5_000)
        let longBundle = String(repeating: "b", count: 5_000)
        let service = ComputerHostService(
            permissions: WorkspaceFakePermissions(),
            workspace: WorkspaceFakeWorkspace(apps: [
                WorkspaceApplication(
                    processIdentifier: 123,
                    name: longName,
                    bundleIdentifier: longBundle,
                    frontmost: true
                ),
            ])
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "apps-2",
            method: "list_apps",
            params: .object([:])
        ))

        let views = try decodeWorkspaceResult([ApplicationView].self, from: response)
        XCTAssertEqual(views.first?.name.count, 4_096)
        XCTAssertEqual(views.first?.bundleIdentifier?.count, 4_096)
    }
}

private struct WorkspaceFakePermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { false }
    func screenCaptureAuthorized() -> Bool { false }
}

private struct WorkspaceFakeWorkspace: WorkspaceReading {
    let apps: [WorkspaceApplication]

    func runningApplications() -> [WorkspaceApplication] { apps }
    func frontmostApplication() -> WorkspaceApplication? { apps.first(where: \.frontmost) }
}

private func decodeWorkspaceResult<T: Decodable>(_ type: T.Type, from response: ComputerProtocolResponse) throws -> T {
    let result = try XCTUnwrap(response.result)
    let data = try JSONEncoder().encode(result)
    return try JSONDecoder().decode(type, from: data)
}
