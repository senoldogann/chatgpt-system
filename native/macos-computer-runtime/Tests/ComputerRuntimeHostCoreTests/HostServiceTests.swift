import Foundation
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

    func testHealthReportsPassiveInputListenAndPostReadiness() async throws {
        let service = ComputerHostService(
            permissions: HostFakePermissions(
                accessibilityTrusted: true,
                screenCaptureAuthorized: false,
                eventListenAuthorized: false,
                eventPostAuthorized: true
            ),
            workspace: HostFakeWorkspace()
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "health-input-readiness",
            method: "health",
            params: .object([:])
        ))

        XCTAssertTrue(response.ok)
        let result = try XCTUnwrap(response.result)
        let health = try JSONDecoder().decode(
            ComputerHealth.self,
            from: JSONEncoder().encode(result)
        )
        XCTAssertEqual(health.state, "running")
        XCTAssertTrue(health.accessibilityTrusted)
        XCTAssertFalse(health.screenCaptureAuthorized)
        XCTAssertFalse(health.eventListenAuthorized)
        XCTAssertTrue(health.eventPostAuthorized)
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

    func testObserveRefreshesRecoveryStateWhenRecoveryIsAvailable() async throws {
        let recovery = HostFakeRecovery(
            resolved: resolvedTarget(source: .ax, x: 40, y: 50),
            error: nil
        )
        let service = ComputerHostService(
            permissions: HostFakePermissions(accessibilityTrusted: true, screenCaptureAuthorized: true),
            workspace: HostFakeWorkspace(),
            recovery: recovery
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "observe-refresh",
            method: "observe",
            params: .object([:])
        ))

        XCTAssertTrue(response.ok)
        let observation = try decodeHostResult(ComputerObservation.self, response: response)
        XCTAssertEqual(observation.snapshotId, "fake")
        let refreshObservationCallCount = await recovery.refreshObservationCallCount
        XCTAssertEqual(refreshObservationCallCount, 1)
    }

    func testResolveTargetUsesRecoveryAndReturnsBoundedView() async throws {
        let recovery = HostFakeRecovery(
            resolved: resolvedTarget(source: .ax, x: 40, y: 50),
            error: nil
        )
        let service = ComputerHostService(
            permissions: HostFakePermissions(accessibilityTrusted: true, screenCaptureAuthorized: true),
            workspace: HostFakeWorkspace(),
            recovery: recovery
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "resolve-one",
            method: "resolve_target",
            params: .object([
                "target": .object([
                    "by": .string("text"),
                    "text": .string("Run"),
                    "exact": .bool(true),
                ]),
                "retryBudget": .number(2),
            ])
        ))

        XCTAssertTrue(response.ok)
        let view = try decodeHostResult(ComputerResolvedTargetView.self, response: response)
        XCTAssertEqual(view.source, .ax)
        XCTAssertEqual(view.actionPoint, ComputerPoint(x: 40, y: 50))
        let call = await recovery.lastResolveCall
        XCTAssertEqual(call?.target, .text(text: "Run", exact: true))
        XCTAssertEqual(call?.retryBudget, 2)
    }

    func testResolveTargetsUsesOneStrictArrayRequest() async throws {
        let recovery = HostFakeRecovery(
            resolved: resolvedTarget(source: .ax, x: 10, y: 20),
            error: nil
        )
        let service = ComputerHostService(
            permissions: HostFakePermissions(accessibilityTrusted: true, screenCaptureAuthorized: true),
            workspace: HostFakeWorkspace(),
            recovery: recovery
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "resolve-many",
            method: "resolve_targets",
            params: .object([
                "targets": .array([
                    .object(["by": .string("text"), "text": .string("Name"), "exact": .bool(true)]),
                    .object(["by": .string("role"), "role": .string("AXButton"), "name": .string("Submit"), "exact": .bool(true)]),
                ]),
                "retryBudget": .number(1),
            ])
        ))

        XCTAssertTrue(response.ok)
        let calls = await recovery.lastResolveManyCall
        XCTAssertEqual(calls?.targets.count, 2)
        XCTAssertEqual(calls?.retryBudget, 1)
    }

    func testResolveTargetRejectsUnknownFieldsAndRetryBudgetAboveTwoBeforeRecovery() async {
        let recovery = HostFakeRecovery(resolved: resolvedTarget(source: .ax, x: 1, y: 1), error: nil)
        let service = ComputerHostService(
            permissions: HostFakePermissions(accessibilityTrusted: true, screenCaptureAuthorized: true),
            workspace: HostFakeWorkspace(),
            recovery: recovery
        )

        let unknown = await service.handle(.init(
            protocolVersion: 1,
            requestId: "resolve-unknown",
            method: "resolve_target",
            params: .object([
                "target": .object(["by": .string("text"), "text": .string("Run")]),
                "unexpected": .bool(true),
            ])
        ))
        assertProtocolInvalid(unknown)

        let oversizedBudget = await service.handle(.init(
            protocolVersion: 1,
            requestId: "resolve-budget",
            method: "resolve_target",
            params: .object([
                "target": .object(["by": .string("text"), "text": .string("Run")]),
                "retryBudget": .number(3),
            ])
        ))
        assertProtocolInvalid(oversizedBudget)
        let resolveCallCount = await recovery.resolveCallCount
        XCTAssertEqual(resolveCallCount, 0)
    }

    func testRecoveryErrorsMapToStableProtocolCodesWithoutNativeDetails() async {
        let cases: [(ComputerRecoveryError, String)] = [
            (.targetNotFound, "COMPUTER_TARGET_NOT_FOUND"),
            (.targetAmbiguous, "COMPUTER_TARGET_AMBIGUOUS"),
            (.staleSnapshot, "COMPUTER_STALE_SNAPSHOT"),
            (.focusFailed, "COMPUTER_FOCUS_FAILED"),
            (.needsReplan, "COMPUTER_NEEDS_REPLAN"),
            (.permissionRequired, "COMPUTER_PERMISSION_REQUIRED"),
        ]

        for (error, code) in cases {
            let recovery = HostFakeRecovery(resolved: nil, error: error)
            let service = ComputerHostService(
                permissions: HostFakePermissions(accessibilityTrusted: true, screenCaptureAuthorized: true),
                workspace: HostFakeWorkspace(),
                recovery: recovery
            )
            let response = await service.handle(.init(
                protocolVersion: 1,
                requestId: "error-\(code)",
                method: "resolve_target",
                params: .object([
                    "target": .object(["by": .string("text"), "text": .string("Run")]),
                ])
            ))

            XCTAssertFalse(response.ok)
            XCTAssertEqual(response.error?.code, code)
            XCTAssertNil(response.error?.details)
            XCTAssertFalse(response.error?.message.localizedCaseInsensitiveContains("vision") ?? true)
            XCTAssertFalse(response.error?.message.localizedCaseInsensitiveContains("ax") ?? true)
        }
    }

    func testExecutableRespondsToMultipleFramesBeforePersistentStdinCloses() throws {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let executableURL = packageRoot.appendingPathComponent(".build/debug/chatgpt-system-computer-runtime")
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: executableURL.path))

        let process = Process()
        let input = Pipe()
        let output = Pipe()
        let error = Pipe()
        let collector = PipeLineCollector(handle: output.fileHandleForReading)

        process.executableURL = executableURL
        process.standardInput = input
        process.standardOutput = output
        process.standardError = error
        try process.run()

        defer {
            output.fileHandleForReading.readabilityHandler = nil
            try? input.fileHandleForWriting.close()
            if process.isRunning {
                process.terminate()
                process.waitUntilExit()
            }
        }

        try writeRequest(
            requestId: "persistent-1",
            to: input.fileHandleForWriting
        )
        let first = try XCTUnwrap(
            collector.nextLine(timeout: 1.0),
            "Expected first response before stdin EOF"
        )
        let firstResponse = try JSONDecoder().decode(ComputerProtocolResponse.self, from: first)
        XCTAssertTrue(firstResponse.ok)
        XCTAssertEqual(firstResponse.requestId, "persistent-1")
        XCTAssertTrue(process.isRunning, "Helper must remain alive while stdin stays open")

        try writeRequest(
            requestId: "persistent-2",
            to: input.fileHandleForWriting
        )
        let second = try XCTUnwrap(
            collector.nextLine(timeout: 1.0),
            "Expected second response on the same still-open stdin pipe"
        )
        let secondResponse = try JSONDecoder().decode(ComputerProtocolResponse.self, from: second)
        XCTAssertTrue(secondResponse.ok)
        XCTAssertEqual(secondResponse.requestId, "persistent-2")
        XCTAssertTrue(process.isRunning, "Helper must remain alive until cleanup closes stdin")
    }
}

private final class PipeLineCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = Data()
    private var lines: [Data] = []
    private let availableLine = DispatchSemaphore(value: 0)

    init(handle: FileHandle) {
        handle.readabilityHandler = { [weak self] readable in
            let data = readable.availableData
            guard !data.isEmpty else { return }
            self?.append(data)
        }
    }

    func nextLine(timeout: TimeInterval) -> Data? {
        guard availableLine.wait(timeout: .now() + timeout) == .success else {
            return nil
        }
        lock.lock()
        defer { lock.unlock() }
        guard !lines.isEmpty else { return nil }
        return lines.removeFirst()
    }

    private func append(_ data: Data) {
        lock.lock()
        buffer.append(data)
        var completed: [Data] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            var line = Data(buffer[..<newline])
            buffer.removeSubrange(...newline)
            if line.last == 0x0D {
                line.removeLast()
            }
            completed.append(line)
        }
        lines.append(contentsOf: completed)
        lock.unlock()

        for _ in completed {
            availableLine.signal()
        }
    }
}

private func writeRequest(requestId: String, to handle: FileHandle) throws {
    let request = #"{"protocolVersion":1,"requestId":"\#(requestId)","method":"health","params":{}}"#
    try handle.write(contentsOf: Data("\(request)\n".utf8))
}

private struct HostFakePermissions: PermissionReading {
    let accessibilityTrustedValue: Bool
    let screenCaptureAuthorizedValue: Bool
    let eventListenAuthorizedValue: Bool
    let eventPostAuthorizedValue: Bool

    init(
        accessibilityTrusted: Bool = false,
        screenCaptureAuthorized: Bool = false,
        eventListenAuthorized: Bool = false,
        eventPostAuthorized: Bool = false
    ) {
        self.accessibilityTrustedValue = accessibilityTrusted
        self.screenCaptureAuthorizedValue = screenCaptureAuthorized
        self.eventListenAuthorizedValue = eventListenAuthorized
        self.eventPostAuthorizedValue = eventPostAuthorized
    }

    func accessibilityTrusted() -> Bool { accessibilityTrustedValue }
    func screenCaptureAuthorized() -> Bool { screenCaptureAuthorizedValue }
    func eventListenAuthorized() -> Bool { eventListenAuthorizedValue }
    func eventPostAuthorized() -> Bool { eventPostAuthorizedValue }
}

private struct HostFakeWorkspace: WorkspaceReading {
    func runningApplications() -> [WorkspaceApplication] { [] }
    func frontmostApplication() -> WorkspaceApplication? { nil }
}

private func makeHostService() -> ComputerHostService {
    ComputerHostService(permissions: HostFakePermissions(), workspace: HostFakeWorkspace())
}


private actor HostFakeRecovery: ComputerRecoveryHandling {
    struct ResolveCall: Sendable {
        let target: ComputerTarget
        let retryBudget: Int
    }

    struct ResolveManyCall: Sendable {
        let targets: [ComputerTarget]
        let retryBudget: Int
    }

    let resolved: ResolvedComputerTarget?
    let error: ComputerRecoveryError?
    private(set) var lastResolveCall: ResolveCall?
    private(set) var lastResolveManyCall: ResolveManyCall?
    private(set) var resolveCallCount = 0
    private(set) var refreshObservationCallCount = 0

    init(resolved: ResolvedComputerTarget?, error: ComputerRecoveryError?) {
        self.resolved = resolved
        self.error = error
    }

    func resolve(_ target: ComputerTarget, retryBudget: Int) async throws -> ResolvedComputerTarget {
        resolveCallCount += 1
        lastResolveCall = ResolveCall(target: target, retryBudget: retryBudget)
        if let error { throw error }
        return resolved!
    }

    func resolveMany(_ targets: [ComputerTarget], retryBudget: Int) async throws -> [ResolvedComputerTarget] {
        lastResolveManyCall = ResolveManyCall(targets: targets, retryBudget: retryBudget)
        if let error { throw error }
        guard let resolved else { return [] }
        return targets.map { _ in resolved }
    }

    func refreshObservation() async throws -> ComputerObservation {
        refreshObservationCallCount += 1
        return ComputerObservation(
            snapshotId: "fake",
            application: ApplicationView(name: "Fixture", bundleIdentifier: "com.example.fixture", frontmost: true),
            windowTitle: nil,
            elements: [],
            truncated: false
        )
    }
}

private func resolvedTarget(source: ComputerTargetSource, x: Double, y: Double) -> ResolvedComputerTarget {
    ResolvedComputerTarget(
        source: source,
        bounds: ComputerBounds(x: x - 5, y: y - 5, width: 10, height: 10),
        actionPoint: ComputerPoint(x: x, y: y),
        observationId: "obs",
        appIdentity: "com.example.fixture",
        windowIdentity: "window",
        windowGeneration: "generation",
        displayTopologyDigest: "topology",
        confidence: source == .point ? .explicit : .deterministic,
        semanticFingerprint: "fingerprint"
    )
}

private func decodeHostResult<T: Decodable>(_ type: T.Type, response: ComputerProtocolResponse) throws -> T {
    let result = try XCTUnwrap(response.result)
    return try JSONDecoder().decode(T.self, from: JSONEncoder().encode(result))
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
