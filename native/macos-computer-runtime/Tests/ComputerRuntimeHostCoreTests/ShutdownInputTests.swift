import Foundation
import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class ShutdownInputTests: XCTestCase {
    func testServerEOFInvokesActionServiceShutdownRelease() async throws {
        let actionHandler = ShutdownSpyActionHandler()
        let service = ComputerHostService(
            permissions: ShutdownPermissions(),
            workspace: ShutdownWorkspace(),
            actions: actionHandler
        )
        let server = NDJSONHostServer(service: service)
        let input = Pipe()
        let output = Pipe()
        try input.fileHandleForWriting.close()

        try await server.run(input: input.fileHandleForReading, output: output.fileHandleForWriting)

        let shutdownCount = await actionHandler.shutdownCount()
        XCTAssertEqual(shutdownCount, 1)
    }

    func testServerFramingErrorInvokesActionServiceShutdownRelease() async {
        let actionHandler = ShutdownSpyActionHandler()
        let service = ComputerHostService(
            permissions: ShutdownPermissions(),
            workspace: ShutdownWorkspace(),
            actions: actionHandler
        )
        let server = NDJSONHostServer(service: service)
        let input = Pipe()
        let output = Pipe()

        do {
            try input.fileHandleForWriting.write(contentsOf: Data("partial-frame-without-newline".utf8))
            try input.fileHandleForWriting.close()
            try await server.run(input: input.fileHandleForReading, output: output.fileHandleForWriting)
            XCTFail("Expected framing error")
        } catch {}

        let shutdownCount = await actionHandler.shutdownCount()
        XCTAssertEqual(shutdownCount, 1)
    }

    func testShutdownReleaseIsIdempotent() async throws {
        let sink = ShutdownRecordingSink()
        let controller = ComputerInputController(
            eventSink: sink,
            pointerReader: ShutdownPointer(),
            displayTopology: ShutdownDisplays(),
            sleeper: ShutdownSleeper()
        )
        _ = try await controller.mouseDown(.left)
        let service = ComputerHostService(
            permissions: ShutdownPermissions(),
            workspace: ShutdownWorkspace(),
            actions: ComputerActionService(controller: controller)
        )

        await service.shutdown()
        await service.shutdown()

        let ups = sink.events.filter { event in
            if case .mouseButton(button: .left, down: false, _, _) = event { return true }
            return false
        }
        XCTAssertEqual(ups.count, 1)
        let held = await controller.heldInputState()
        XCTAssertTrue(held.isEmpty)
    }
}

private actor ShutdownSpyActionHandler: ComputerActionHandling {
    private var count = 0

    func handleAction(_ request: ComputerProtocolRequest) async -> ComputerProtocolResponse? { nil }
    func shutdown() async { count += 1 }
    func shutdownCount() -> Int { count }
}

private final class ShutdownRecordingSink: InputEventSink, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [InputEvent] = []

    var events: [InputEvent] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func emit(_ event: InputEvent) throws {
        lock.lock(); storage.append(event); lock.unlock()
    }
}

private struct ShutdownPointer: PointerReading {
    func currentPointerPosition() throws -> ComputerPoint { ComputerPoint(x: 10, y: 10) }
}

private struct ShutdownDisplays: DisplayTopologyReading {
    func activeDisplayBounds() throws -> [ComputerBounds] {
        [ComputerBounds(x: 0, y: 0, width: 100, height: 100)]
    }
}

private struct ShutdownSleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {}
}

private struct ShutdownPermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { true }
    func screenCaptureAuthorized() -> Bool { false }
}

private struct ShutdownWorkspace: WorkspaceReading {
    func runningApplications() -> [WorkspaceApplication] { [] }
    func frontmostApplication() -> WorkspaceApplication? { nil }
}
