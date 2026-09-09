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
