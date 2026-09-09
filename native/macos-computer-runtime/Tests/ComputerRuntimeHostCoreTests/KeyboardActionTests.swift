import Carbon.HIToolbox
import Foundation
import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class KeyboardActionTests: XCTestCase {
    func testCentralKeyMapHasExpectedLettersNavigationAndFunctionKeys() {
        XCTAssertEqual(KeyMapping.keyCode(for: "a"), UInt16(kVK_ANSI_A))
        XCTAssertEqual(KeyMapping.keyCode(for: "z"), UInt16(kVK_ANSI_Z))
        XCTAssertEqual(KeyMapping.keyCode(for: "0"), UInt16(kVK_ANSI_0))
        XCTAssertEqual(KeyMapping.keyCode(for: "9"), UInt16(kVK_ANSI_9))
        XCTAssertEqual(KeyMapping.keyCode(for: "left"), UInt16(kVK_LeftArrow))
        XCTAssertEqual(KeyMapping.keyCode(for: "page_down"), UInt16(kVK_PageDown))
        XCTAssertEqual(KeyMapping.keyCode(for: "f12"), UInt16(kVK_F12))
        XCTAssertNil(KeyMapping.keyCode(for: "volume_up"))
        XCTAssertEqual(KeyMapping.modifierKeyCode(for: .control), UInt16(kVK_Control))
        XCTAssertEqual(KeyMapping.modifierKeyCode(for: .command), UInt16(kVK_Command))
    }

    func testPressKeyPostsModifiersDownKeyDownKeyUpModifiersUpInOrder() async throws {
        let harness = KeyboardHarness()
        let focus = AlwaysKeyboardFocusGuard()
        let keyCode = try XCTUnwrap(KeyMapping.keyCode(for: "a"))
        let control = KeyMapping.modifierKeyCode(for: .control)
        let command = KeyMapping.modifierKeyCode(for: .command)

        _ = try await harness.controller.pressKey(
            named: "a",
            modifiers: [.command, .control],
            focusGuard: focus
        )

        XCTAssertEqual(harness.sink.events, [
            .key(keyCode: control, down: true, modifiers: [.control]),
            .key(keyCode: command, down: true, modifiers: [.control, .command]),
            .key(keyCode: keyCode, down: true, modifiers: [.control, .command]),
            .key(keyCode: keyCode, down: false, modifiers: [.control, .command]),
            .key(keyCode: command, down: false, modifiers: [.control]),
            .key(keyCode: control, down: false, modifiers: []),
        ])
        let held = await harness.controller.heldInputState()
        XCTAssertTrue(held.isEmpty)
    }

    func testPressKeyRejectsUnknownKeyWithoutEmission() async {
        let harness = KeyboardHarness()

        do {
            _ = try await harness.controller.pressKey(
                named: "definitely_not_a_key",
                modifiers: [],
                focusGuard: AlwaysKeyboardFocusGuard()
            )
            XCTFail("Expected invalidInput")
        } catch {
            XCTAssertEqual(error as? ComputerInputError, .invalidInput)
        }
        XCTAssertEqual(harness.sink.events, [])
    }

    func testUnicodeTypingUsesBoundedUtf16Chunks() async throws {
        let harness = KeyboardHarness()
        let text = String(repeating: "a", count: 42)

        _ = try await harness.controller.typeText(text, focusGuard: AlwaysKeyboardFocusGuard())

        let chunks = harness.sink.events.compactMap { event -> String? in
            if case let .unicode(value) = event { return value }
            return nil
        }
        XCTAssertEqual(chunks.joined(), text)
        XCTAssertEqual(chunks.count, 3)
        XCTAssertTrue(chunks.allSatisfy { $0.utf16.count <= 20 })
    }

    func testTypingChecksExpectedFrontmostBeforeEveryChunk() async throws {
        let harness = KeyboardHarness()
        let focus = CountingKeyboardFocusGuard()
        let text = String(repeating: "x", count: 41)

        _ = try await harness.controller.typeText(text, focusGuard: focus)

        let verificationCount = await focus.verificationCount()
        XCTAssertEqual(verificationCount, 4, "One pre-action check plus one check before each of three chunks")
    }

    func testFocusChangeDuringTypingFailsBeforeNextChunkAndReleasesModifiers() async {
        let held = HeldInputStore()
        await held.insertModifier(.command)
        let harness = KeyboardHarness(heldInputs: held)
        let focus = FailingKeyboardFocusGuard(failOnCall: 3)
        let command = KeyMapping.modifierKeyCode(for: .command)

        do {
            _ = try await harness.controller.typeText(
                String(repeating: "a", count: 30),
                focusGuard: focus
            )
            XCTFail("Expected focusMismatch")
        } catch {
            XCTAssertEqual(error as? ComputerInputError, .focusMismatch)
        }

        XCTAssertEqual(harness.sink.events, [
            .unicode(String(repeating: "a", count: 20)),
            .key(keyCode: command, down: false, modifiers: []),
        ])
        let snapshot = await harness.controller.heldInputState()
        XCTAssertTrue(snapshot.isEmpty)
    }

    func testReleaseAllInputsReleasesKeysModifiersAndMouseButtonsInDeterministicOrder() async throws {
        let held = HeldInputStore()
        await held.insertKeyCode(12)
        await held.insertKeyCode(4)
        await held.insertModifier(.command)
        await held.insertModifier(.control)
        await held.insertMouseButton(.right)
        await held.insertMouseButton(.left)
        let harness = KeyboardHarness(heldInputs: held)
        let control = KeyMapping.modifierKeyCode(for: .control)
        let command = KeyMapping.modifierKeyCode(for: .command)

        try await harness.controller.releaseAllInputs()

        XCTAssertEqual(harness.sink.events, [
            .key(keyCode: 4, down: false, modifiers: [.control, .command]),
            .key(keyCode: 12, down: false, modifiers: [.control, .command]),
            .key(keyCode: command, down: false, modifiers: [.control]),
            .key(keyCode: control, down: false, modifiers: []),
            .mouseButton(button: .left, down: false, point: ComputerPoint(x: 25, y: 30), clickCount: 1),
            .mouseButton(button: .right, down: false, point: ComputerPoint(x: 25, y: 30), clickCount: 1),
        ])
        let snapshot = await harness.controller.heldInputState()
        XCTAssertTrue(snapshot.isEmpty)
    }

    func testReleaseAllInputsIsIdempotent() async throws {
        let held = HeldInputStore()
        await held.insertMouseButton(.left)
        let harness = KeyboardHarness(heldInputs: held)

        try await harness.controller.releaseAllInputs()
        let countAfterFirst = harness.sink.events.count
        try await harness.controller.releaseAllInputs()

        XCTAssertEqual(harness.sink.events.count, countAfterFirst)
        XCTAssertEqual(countAfterFirst, 1)
    }

    func testSinkFailureDuringKeyChordStillAttemptsEveryHeldRelease() async {
        let keyCode = KeyMapping.keyCode(for: "a")!
        let sink = KeyboardRecordingSink(failFirstKeyUp: keyCode)
        let harness = KeyboardHarness(sink: sink)
        let control = KeyMapping.modifierKeyCode(for: .control)
        let command = KeyMapping.modifierKeyCode(for: .command)

        do {
            _ = try await harness.controller.pressKey(
                named: "a",
                modifiers: [.control, .command],
                focusGuard: AlwaysKeyboardFocusGuard()
            )
            XCTFail("Expected injected sink failure")
        } catch {}

        XCTAssertEqual(sink.attempts.suffix(4), [
            .key(keyCode: keyCode, down: false, modifiers: [.control, .command]),
            .key(keyCode: keyCode, down: false, modifiers: [.control, .command]),
            .key(keyCode: command, down: false, modifiers: [.control]),
            .key(keyCode: control, down: false, modifiers: []),
        ])
        let snapshot = await harness.controller.heldInputState()
        XCTAssertTrue(snapshot.isEmpty)
    }

    func testCancellationDuringKeyboardActionReleasesHeldInput() async throws {
        let focus = BlockingKeyboardFocusGuard(blockOnCall: 3)
        let harness = KeyboardHarness()
        let control = KeyMapping.modifierKeyCode(for: .control)

        let task = Task {
            try await harness.controller.pressKey(
                named: "a",
                modifiers: [.control, .command],
                focusGuard: focus
            )
        }
        await focus.waitUntilBlocked()
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch {}

        XCTAssertTrue(harness.sink.events.contains(.key(keyCode: control, down: false, modifiers: [])))
        let snapshot = await harness.controller.heldInputState()
        XCTAssertTrue(snapshot.isEmpty)
    }

    func testKeyboardProtocolRequiresExpectedApplicationAndRejectsUnknownFields() async {
        let target = keyboardApp(pid: 10, name: "Fixture", bundle: "com.example.fixture")
        let appController = KeyboardApplicationController(apps: [target], frontmost: target)
        let harness = KeyboardHarness()
        let service = KeyboardServiceFactory.make(harness: harness, appController: appController)

        let cases: [(String, JSONValue)] = [
            ("type_text", .object(["text": .string("abc")])),
            ("type_text", .object(["text": .string("abc"), "bundleIdentifier": .string("com.example.fixture"), "extra": .bool(true)])),
            ("type_text", .object(["text": .string(String(repeating: "a", count: 16_385)), "bundleIdentifier": .string("com.example.fixture")])),
            ("press_key", .object(["key": .string("unknown"), "bundleIdentifier": .string("com.example.fixture")])),
            ("release_inputs", .object(["extra": .bool(true)])),
        ]

        for (method, params) in cases {
            let response = await service.handle(.init(protocolVersion: 1, requestId: method, method: method, params: params))
            XCTAssertFalse(response.ok)
            XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID")
        }
    }

    func testKeyboardProtocolFocusMismatchReturnsStableError() async {
        let target = keyboardApp(pid: 10, name: "Fixture", bundle: "com.example.fixture")
        let other = keyboardApp(pid: 20, name: "Other", bundle: "com.example.other")
        let appController = KeyboardApplicationController(apps: [target, other], frontmost: other)
        let service = KeyboardServiceFactory.make(harness: KeyboardHarness(), appController: appController)

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "focus-mismatch",
            method: "type_text",
            params: .object([
                "text": .string("abc"),
                "bundleIdentifier": .string("com.example.fixture"),
            ])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_FOCUS_FAILED")
        XCTAssertEqual(response.error?.message, "Computer focus verification failed.")
    }
}

private enum KeyboardInjectedError: Error { case failure }

private final class KeyboardRecordingSink: InputEventSink, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [InputEvent] = []
    private var attemptStorage: [InputEvent] = []
    private let failFirstKeyUp: UInt16?
    private var hasFailedKeyUp = false

    init(failFirstKeyUp: UInt16? = nil) {
        self.failFirstKeyUp = failFirstKeyUp
    }

    var events: [InputEvent] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    var attempts: [InputEvent] {
        lock.lock(); defer { lock.unlock() }
        return attemptStorage
    }

    func emit(_ event: InputEvent) throws {
        lock.lock()
        attemptStorage.append(event)
        if let failFirstKeyUp,
           !hasFailedKeyUp,
           case let .key(keyCode, down, _) = event,
           keyCode == failFirstKeyUp,
           !down
        {
            hasFailedKeyUp = true
            lock.unlock()
            throw KeyboardInjectedError.failure
        }
        storage.append(event)
        lock.unlock()
    }
}

private struct KeyboardPointer: PointerReading {
    func currentPointerPosition() throws -> ComputerPoint { ComputerPoint(x: 25, y: 30) }
}

private struct KeyboardDisplays: DisplayTopologyReading {
    func activeDisplayBounds() throws -> [ComputerBounds] {
        [ComputerBounds(x: 0, y: 0, width: 1_728, height: 1_117)]
    }
}

private struct KeyboardSleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {}
}

private struct AlwaysKeyboardFocusGuard: InputFocusGuard {
    func verifyExpectedFrontmost() async throws {}
}

private actor CountingKeyboardFocusGuard: InputFocusGuard {
    private var count = 0
    func verifyExpectedFrontmost() async throws { count += 1 }
    func verificationCount() -> Int { count }
}

private actor FailingKeyboardFocusGuard: InputFocusGuard {
    private var count = 0
    private let failOnCall: Int

    init(failOnCall: Int) { self.failOnCall = failOnCall }

    func verifyExpectedFrontmost() async throws {
        count += 1
        if count == failOnCall { throw ComputerInputError.focusMismatch }
    }
}

private actor BlockingKeyboardFocusGuard: InputFocusGuard {
    private var count = 0
    private var blocked = false
    private let blockOnCall: Int

    init(blockOnCall: Int) { self.blockOnCall = blockOnCall }

    func verifyExpectedFrontmost() async throws {
        count += 1
        guard count == blockOnCall else { return }
        blocked = true
        try await Task.sleep(for: .seconds(60))
    }

    func waitUntilBlocked() async {
        while !blocked { await Task.yield() }
    }
}

private struct KeyboardHarness {
    let sink: KeyboardRecordingSink
    let heldInputs: HeldInputStore
    let controller: ComputerInputController

    init(
        sink: KeyboardRecordingSink = KeyboardRecordingSink(),
        heldInputs: HeldInputStore = HeldInputStore()
    ) {
        self.sink = sink
        self.heldInputs = heldInputs
        self.controller = ComputerInputController(
            eventSink: sink,
            pointerReader: KeyboardPointer(),
            displayTopology: KeyboardDisplays(),
            sleeper: KeyboardSleeper(),
            heldInputs: heldInputs
        )
    }
}

private final class KeyboardApplicationController: ApplicationControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var apps: [WorkspaceApplication]
    private var frontmost: WorkspaceApplication?

    init(apps: [WorkspaceApplication], frontmost: WorkspaceApplication?) {
        self.apps = apps
        self.frontmost = frontmost
    }

    func runningApplications() -> [WorkspaceApplication] {
        lock.lock(); defer { lock.unlock() }
        return apps
    }

    func frontmostApplication() -> WorkspaceApplication? {
        lock.lock(); defer { lock.unlock() }
        return frontmost
    }

    func applicationURL(bundleIdentifier: String) -> URL? { nil }
    func openApplication(at url: URL) async throws -> WorkspaceApplication { throw KeyboardInjectedError.failure }
    func activate(_ application: WorkspaceApplication) -> Bool { false }
}

private enum KeyboardServiceFactory {
    static func make(
        harness: KeyboardHarness,
        appController: KeyboardApplicationController
    ) -> ComputerHostService {
        ComputerHostService(
            permissions: KeyboardPermissions(),
            workspace: KeyboardWorkspace(),
            actions: ComputerActionService(
                controller: harness.controller,
                applicationController: appController,
                appSleeper: KeyboardSleeper()
            )
        )
    }
}

private struct KeyboardPermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { true }
    func screenCaptureAuthorized() -> Bool { false }
}

private struct KeyboardWorkspace: WorkspaceReading {
    func runningApplications() -> [WorkspaceApplication] { [] }
    func frontmostApplication() -> WorkspaceApplication? { nil }
}

private func keyboardApp(pid: pid_t, name: String, bundle: String?) -> WorkspaceApplication {
    WorkspaceApplication(processIdentifier: pid, name: name, bundleIdentifier: bundle, frontmost: false)
}
