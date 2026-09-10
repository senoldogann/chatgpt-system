import Foundation
import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class AppControlTests: XCTestCase {
    func testFocusUsesBundleIdentifierBeforeName() async throws {
        let bundleApp = app(pid: 10, name: "Correct", bundle: "com.example.target")
        let nameApp = app(pid: 20, name: "Wrong Name", bundle: "com.example.other")
        let workspace = FakeApplicationController(apps: [bundleApp, nameApp], becomesFrontmost: true)
        let service = makeAppHostService(workspace: workspace)

        let response = await request(
            service,
            method: "focus_app",
            params: .object([
                "bundleIdentifier": .string("com.example.target"),
                "name": .string("Wrong Name"),
                "timeoutMs": .number(50),
            ])
        )

        XCTAssertTrue(response.ok)
        XCTAssertEqual(workspace.activatedProcessIdentifiers, [10])
        let view = try decodeAppResult(ApplicationView.self, from: response)
        XCTAssertEqual(view.bundleIdentifier, "com.example.target")
        XCTAssertTrue(view.frontmost)
    }

    func testNameFallbackRequiresExactlyOneRunningMatch() async {
        let workspace = FakeApplicationController(
            apps: [app(pid: 30, name: "Fixture", bundle: "com.example.fixture")],
            becomesFrontmost: true
        )
        let service = makeAppHostService(workspace: workspace)
        let response = await request(
            service,
            method: "focus_app",
            params: .object(["name": .string("Fixture"), "timeoutMs": .number(50)])
        )

        XCTAssertTrue(response.ok)
        XCTAssertEqual(workspace.activatedProcessIdentifiers, [30])
    }

    func testAmbiguousNameReturnsStableError() async {
        let workspace = FakeApplicationController(apps: [
            app(pid: 1, name: "Fixture", bundle: "a"),
            app(pid: 2, name: "Fixture", bundle: "b"),
        ])
        let response = await request(
            makeAppHostService(workspace: workspace),
            method: "focus_app",
            params: .object(["name": .string("Fixture")])
        )

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_TARGET_AMBIGUOUS")
        XCTAssertEqual(response.error?.message, "Computer target is ambiguous.")
    }

    func testOpenUsesResolvedBundleURLNotProtocolPath() async throws {
        let expectedURL = URL(fileURLWithPath: "/Applications/Fixture.app")
        let opened = app(pid: 40, name: "Fixture", bundle: "com.example.fixture")
        let workspace = FakeApplicationController(
            apps: [],
            urls: ["com.example.fixture": expectedURL],
            openResult: opened,
            becomesFrontmost: true
        )
        let service = makeAppHostService(workspace: workspace)

        let response = await request(
            service,
            method: "open_app",
            params: .object([
                "bundleIdentifier": .string("com.example.fixture"),
                "timeoutMs": .number(50),
            ])
        )

        XCTAssertTrue(response.ok)
        XCTAssertEqual(workspace.requestedBundleIdentifiers, ["com.example.fixture"])
        XCTAssertEqual(workspace.openedURLs, [expectedURL])
        let encoded = String(decoding: try JSONEncoder().encode(response), as: UTF8.self)
        XCTAssertFalse(encoded.contains("processIdentifier"))
        XCTAssertFalse(encoded.contains("\"pid\""))
    }

    func testFocusSuccessRequiresAppToBecomeFrontmost() async throws {
        let target = app(pid: 50, name: "Fixture", bundle: "com.example.fixture")
        let workspace = FakeApplicationController(apps: [target], becomesFrontmost: true)
        let response = await request(
            makeAppHostService(workspace: workspace),
            method: "focus_app",
            params: .object(["bundleIdentifier": .string("com.example.fixture"), "timeoutMs": .number(50)])
        )

        XCTAssertTrue(response.ok)
        XCTAssertTrue(try decodeAppResult(ApplicationView.self, from: response).frontmost)
    }

    func testFocusAwaitsAsynchronousActivationHandoffBeforePolling() async throws {
        let target = app(pid: 55, name: "Fixture", bundle: "com.example.fixture")
        let workspace = FakeApplicationController(
            apps: [target],
            becomesFrontmost: true,
            activationDelayNanoseconds: 20_000_000
        )
        let response = await request(
            makeAppHostService(workspace: workspace),
            method: "focus_app",
            params: .object(["bundleIdentifier": .string("com.example.fixture"), "timeoutMs": .number(100)])
        )

        XCTAssertTrue(response.ok)
        XCTAssertEqual(workspace.activatedProcessIdentifiers, [55])
        XCTAssertTrue(try decodeAppResult(ApplicationView.self, from: response).frontmost)
    }

    func testFocusFailureReturnsComputerFocusFailed() async {
        let target = app(pid: 60, name: "Fixture", bundle: "com.example.fixture")
        let workspace = FakeApplicationController(apps: [target], activationAccepted: true, becomesFrontmost: false)
        let response = await request(
            makeAppHostService(workspace: workspace),
            method: "focus_app",
            params: .object(["bundleIdentifier": .string("com.example.fixture"), "timeoutMs": .number(50)])
        )

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_FOCUS_FAILED")
        XCTAssertEqual(response.error?.message, "Computer focus verification failed.")
    }

    func testFocusTimeoutDoesNotStartAnotherPollAfterDeadlinePasses() async {
        let target = app(pid: 61, name: "Fixture", bundle: "com.example.fixture")
        let workspace = FakeApplicationController(apps: [target], activationAccepted: true, becomesFrontmost: false)
        let sleeper = SlowAppSleeper(delayNanoseconds: 60_000_000)
        let response = await request(
            makeAppHostService(workspace: workspace, appSleeper: sleeper),
            method: "focus_app",
            params: .object(["bundleIdentifier": .string("com.example.fixture"), "timeoutMs": .number(50)])
        )

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_FOCUS_FAILED")
        let calls = await sleeper.callCount()
        XCTAssertEqual(calls, 1)
    }

    func testOpenAndFocusRejectUnknownParams() async {
        let workspace = FakeApplicationController(apps: [])
        let service = makeAppHostService(workspace: workspace)
        for method in ["open_app", "focus_app"] {
            let response = await request(
                service,
                method: method,
                params: .object([
                    "bundleIdentifier": .string("com.example.fixture"),
                    "path": .string("/tmp/not-allowed.app"),
                ])
            )
            XCTAssertFalse(response.ok)
            XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID")
        }
    }

    func testNativeWorkspaceErrorDoesNotLeak() async throws {
        let url = URL(fileURLWithPath: "/Applications/Fixture.app")
        let workspace = FakeApplicationController(
            apps: [],
            urls: ["com.example.fixture": url],
            openError: FakeWorkspaceError.failure("native-workspace-secret")
        )
        let response = await request(
            makeAppHostService(workspace: workspace),
            method: "open_app",
            params: .object(["bundleIdentifier": .string("com.example.fixture")])
        )

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_ACTION_FAILED")
        let encoded = String(decoding: try JSONEncoder().encode(response), as: UTF8.self)
        XCTAssertFalse(encoded.contains("native-workspace-secret"))
    }
}

private enum FakeWorkspaceError: Error {
    case failure(String)
}

private final class FakeApplicationController: ApplicationControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var apps: [WorkspaceApplication]
    private var frontmostPID: pid_t?
    private let urls: [String: URL]
    private let openResult: WorkspaceApplication?
    private let openError: Error?
    private let activationAccepted: Bool
    private let becomesFrontmost: Bool
    private let activationDelayNanoseconds: UInt64
    private var activationLog: [pid_t] = []
    private var bundleLog: [String] = []
    private var openLog: [URL] = []

    init(
        apps: [WorkspaceApplication],
        urls: [String: URL] = [:],
        openResult: WorkspaceApplication? = nil,
        openError: Error? = nil,
        activationAccepted: Bool = true,
        becomesFrontmost: Bool = false,
        activationDelayNanoseconds: UInt64 = 0
    ) {
        self.apps = apps
        self.urls = urls
        self.openResult = openResult
        self.openError = openError
        self.activationAccepted = activationAccepted
        self.becomesFrontmost = becomesFrontmost
        self.activationDelayNanoseconds = activationDelayNanoseconds
    }

    var activatedProcessIdentifiers: [pid_t] { withLock { activationLog } }
    var requestedBundleIdentifiers: [String] { withLock { bundleLog } }
    var openedURLs: [URL] { withLock { openLog } }

    func runningApplications() -> [WorkspaceApplication] {
        withLock {
            apps.map { app in
                WorkspaceApplication(
                    processIdentifier: app.processIdentifier,
                    name: app.name,
                    bundleIdentifier: app.bundleIdentifier,
                    frontmost: app.processIdentifier == frontmostPID
                )
            }
        }
    }

    func frontmostApplication() -> WorkspaceApplication? {
        withLock {
            guard let pid = frontmostPID, let app = apps.first(where: { $0.processIdentifier == pid }) else { return nil }
            return WorkspaceApplication(
                processIdentifier: app.processIdentifier,
                name: app.name,
                bundleIdentifier: app.bundleIdentifier,
                frontmost: true
            )
        }
    }

    func applicationURL(bundleIdentifier: String) -> URL? {
        withLock {
            bundleLog.append(bundleIdentifier)
            return urls[bundleIdentifier]
        }
    }

    func openApplication(at url: URL) async throws -> WorkspaceApplication {
        let (error, result): (Error?, WorkspaceApplication?) = withLock {
            openLog.append(url)
            let result = openResult
            if let result, !apps.contains(where: { $0.processIdentifier == result.processIdentifier }) {
                apps.append(result)
            }
            return (openError, result)
        }
        if let error { throw error }
        guard let result else { throw FakeWorkspaceError.failure("missing-open-result") }
        return result
    }

    func activate(_ application: WorkspaceApplication) async -> Bool {
        if activationDelayNanoseconds > 0 {
            try? await Task.sleep(nanoseconds: activationDelayNanoseconds)
        }
        return withLock {
            activationLog.append(application.processIdentifier)
            if activationAccepted && becomesFrontmost {
                frontmostPID = application.processIdentifier
            }
            return activationAccepted
        }
    }

    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }
}

private struct AppNoopSink: InputEventSink { func emit(_ event: InputEvent) throws {} }
private struct AppPointer: PointerReading { func currentPointerPosition() throws -> ComputerPoint { ComputerPoint(x: 0, y: 0) } }
private struct AppDisplays: DisplayTopologyReading { func activeDisplayBounds() throws -> [ComputerBounds] { [ComputerBounds(x: 0, y: 0, width: 100, height: 100)] } }
private struct AppImmediateSleeper: InputSleeping { func sleep(nanoseconds: UInt64) async throws {} }
private actor SlowAppSleeper: InputSleeping {
    private let delayNanoseconds: UInt64
    private var calls = 0

    init(delayNanoseconds: UInt64) { self.delayNanoseconds = delayNanoseconds }

    func sleep(nanoseconds: UInt64) async throws {
        calls += 1
        try await Task.sleep(nanoseconds: delayNanoseconds)
    }

    func callCount() -> Int { calls }
}
private struct AppPermissions: PermissionReading { func accessibilityTrusted() -> Bool { true }; func screenCaptureAuthorized() -> Bool { false } }
private struct AppWorkspaceReader: WorkspaceReading { func runningApplications() -> [WorkspaceApplication] { [] }; func frontmostApplication() -> WorkspaceApplication? { nil } }

private func makeAppHostService(
    workspace: FakeApplicationController,
    appSleeper: any InputSleeping = AppImmediateSleeper()
) -> ComputerHostService {
    let controller = ComputerInputController(
        eventSink: AppNoopSink(),
        pointerReader: AppPointer(),
        displayTopology: AppDisplays(),
        sleeper: AppImmediateSleeper()
    )
    return ComputerHostService(
        permissions: AppPermissions(),
        workspace: AppWorkspaceReader(),
        actions: ComputerActionService(
            controller: controller,
            applicationController: workspace,
            appSleeper: appSleeper
        )
    )
}

private func request(_ service: ComputerHostService, method: String, params: JSONValue) async -> ComputerProtocolResponse {
    await service.handle(.init(protocolVersion: 1, requestId: "app-test", method: method, params: params))
}

private func app(pid: pid_t, name: String, bundle: String?) -> WorkspaceApplication {
    WorkspaceApplication(processIdentifier: pid, name: name, bundleIdentifier: bundle, frontmost: false)
}

private func decodeAppResult<T: Decodable>(_ type: T.Type, from response: ComputerProtocolResponse) throws -> T {
    let result = try XCTUnwrap(response.result)
    return try JSONDecoder().decode(T.self, from: JSONEncoder().encode(result))
}
