import Foundation
import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class VerificationTests: XCTestCase {
    func testObservationDigestIgnoresSnapshotIdButChangesWithAXState() throws {
        let first = verificationObservation(snapshotId: "snapshot-a", title: "Ready", focused: false, selected: false)
        let sameState = verificationObservation(snapshotId: "snapshot-b", title: "Ready", focused: false, selected: false)
        let changed = verificationObservation(snapshotId: "snapshot-c", title: "Changed", focused: false, selected: false)

        XCTAssertEqual(try ObservationDigest.digest(first), try ObservationDigest.digest(sameState))
        XCTAssertNotEqual(try ObservationDigest.digest(first), try ObservationDigest.digest(changed))
    }

    func testDigestIncludesFocusedSelectedAndWindowState() throws {
        let baseline = verificationObservation(snapshotId: "a", title: "Ready", focused: false, selected: false)
        let focused = verificationObservation(snapshotId: "b", title: "Ready", focused: true, selected: false)
        let selected = verificationObservation(snapshotId: "c", title: "Ready", focused: false, selected: true)
        let windowChanged = verificationObservation(snapshotId: "d", title: "Ready", focused: false, selected: false, windowTitle: "Other Window")

        let baselineDigest = try ObservationDigest.digest(baseline)
        XCTAssertNotEqual(baselineDigest, try ObservationDigest.digest(focused))
        XCTAssertNotEqual(baselineDigest, try ObservationDigest.digest(selected))
        XCTAssertNotEqual(baselineDigest, try ObservationDigest.digest(windowChanged))
    }

    func testWaitForFrontmostSucceedsAfterBoundedPolls() async throws {
        let target = verificationApp(pid: 2, name: "Fixture", bundle: "com.example.fixture", frontmost: true)
        let other = verificationApp(pid: 1, name: "Other", bundle: "com.example.other", frontmost: true)
        let workspace = VerificationWorkspace(frontmostSequence: [other, other, target], apps: [target, other])
        let engine = makeVerificationEngine(workspace: workspace)

        let result = try await engine.waitForFrontmost(
            ComputerApplicationSelector(bundleIdentifier: "com.example.fixture", name: "Wrong"),
            timeoutMs: 100
        )

        XCTAssertEqual(result.bundleIdentifier, "com.example.fixture")
        XCTAssertTrue(result.frontmost)
    }

    func testWaitForFrontmostTimesOutWithStableFocusError() async {
        let other = verificationApp(pid: 1, name: "Other", bundle: "com.example.other", frontmost: true)
        let workspace = VerificationWorkspace(frontmostSequence: [other], apps: [other])
        let engine = makeVerificationEngine(workspace: workspace)

        do {
            _ = try await engine.waitForFrontmost(
                ComputerApplicationSelector(bundleIdentifier: "com.example.missing", name: nil),
                timeoutMs: 50
            )
            XCTFail("Expected focus timeout")
        } catch {
            XCTAssertEqual(error as? ComputerVerificationError, .focusFailed)
        }
    }

    func testWaitForTextFindsAXTitleOrDescriptionWithoutReadingValue() async throws {
        let observation = verificationObservation(
            snapshotId: "a",
            title: "Fixture Button",
            focused: false,
            selected: false,
            description: "button-clicked"
        )
        let accessibility = VerificationAccessibility(observations: [observation])
        let engine = makeVerificationEngine(accessibility: accessibility)

        try await engine.waitForText("button-clicked", exact: true, timeoutMs: 50)
        XCTAssertEqual(accessibility.observeCount, 1)
    }

    func testWaitForTextExactAndSubstringModes() async throws {
        let observation = verificationObservation(
            snapshotId: "a",
            title: "Status: button-clicked",
            focused: false,
            selected: false
        )
        let engine = makeVerificationEngine(accessibility: VerificationAccessibility(observations: [observation]))

        try await engine.waitForText("button-clicked", exact: false, timeoutMs: 50)

        do {
            try await engine.waitForText("button-clicked", exact: true, timeoutMs: 50)
            XCTFail("Expected exact match timeout")
        } catch {
            XCTAssertEqual(error as? ComputerVerificationError, .timeout)
        }
    }

    func testWaitUntilAXChangedReturnsNewDigest() async throws {
        let first = verificationObservation(snapshotId: "a", title: "Ready", focused: false, selected: false)
        let changed = verificationObservation(snapshotId: "b", title: "Changed", focused: false, selected: false)
        let accessibility = VerificationAccessibility(observations: [first, first, changed])
        let engine = makeVerificationEngine(accessibility: accessibility)
        let baseline = try ObservationDigest.digest(first)

        let newDigest = try await engine.waitUntilAXChanged(from: baseline, timeoutMs: 100)

        XCTAssertEqual(newDigest, try ObservationDigest.digest(changed))
        XCTAssertNotEqual(newDigest, baseline)
    }

    func testWaitUntilAXChangedTimesOut() async {
        let first = verificationObservation(snapshotId: "a", title: "Ready", focused: false, selected: false)
        let engine = makeVerificationEngine(accessibility: VerificationAccessibility(observations: [first]))
        let baseline = try! ObservationDigest.digest(first)

        do {
            _ = try await engine.waitUntilAXChanged(from: baseline, timeoutMs: 50)
            XCTFail("Expected timeout")
        } catch {
            XCTAssertEqual(error as? ComputerVerificationError, .timeout)
        }
    }

    func testScreenRegionRejectsCrossDisplayOrOutOfBoundsRegion() throws {
        let displays = [
            ComputerBounds(x: 0, y: 0, width: 100, height: 100),
            ComputerBounds(x: 100, y: 0, width: 100, height: 100),
        ]

        XCTAssertNil(SystemScreenRegionDigester.resolveRegion(
            bounds: ComputerBounds(x: 90, y: 10, width: 20, height: 20),
            activeDisplays: displays
        ))
        XCTAssertNil(SystemScreenRegionDigester.resolveRegion(
            bounds: ComputerBounds(x: -1, y: 10, width: 10, height: 10),
            activeDisplays: displays
        ))
        let resolved = try XCTUnwrap(SystemScreenRegionDigester.resolveRegion(
            bounds: ComputerBounds(x: 120, y: 10, width: 30, height: 40),
            activeDisplays: displays
        ))
        XCTAssertEqual(resolved.displayIndex, 1)
        XCTAssertEqual(resolved.localBounds, ComputerBounds(x: 20, y: 10, width: 30, height: 40))
    }

    func testScreenRegionChangeUsesDigestOnlyAndReturnsNoPixels() async throws {
        let digester = VerificationScreenDigester(digests: ["baseline", "baseline", "changed"])
        let engine = makeVerificationEngine(screenDigester: digester)
        let bounds = ComputerBounds(x: 10, y: 10, width: 50, height: 50)

        let digest = try await engine.waitUntilScreenRegionChanged(
            bounds: bounds,
            from: "baseline",
            timeoutMs: 100
        )

        XCTAssertEqual(digest, "changed")
        let requestedBounds = await digester.requestedBounds()
        XCTAssertEqual(requestedBounds, [bounds, bounds, bounds])
    }

    func testVerificationNativeErrorDoesNotLeak() async throws {
        let service = ComputerHostService(
            permissions: VerificationPermissions(),
            workspace: VerificationWorkspace(frontmostSequence: [], apps: []),
            actions: ComputerActionService(
                controller: verificationController(),
                verification: FailingVerificationHandler()
            )
        )
        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "verification-error",
            method: "wait_until_changed",
            params: .object([
                "baselineDigest": .string("abc"),
                "timeoutMs": .number(50),
            ])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_ACTION_FAILED")
        let encoded = String(decoding: try JSONEncoder().encode(response), as: UTF8.self)
        XCTAssertFalse(encoded.contains("native-verification-secret"))
    }

    func testObserveResponseCarriesDeterministicDigest() async throws {
        let observation = verificationObservation(snapshotId: "volatile-id", title: "Ready", focused: true, selected: false)
        let app = verificationApp(pid: 1, name: "Fixture", bundle: "com.example.fixture", frontmost: true)
        let service = ComputerHostService(
            permissions: VerificationPermissions(),
            workspace: VerificationWorkspace(frontmostSequence: [app], apps: [app]),
            accessibility: VerificationAccessibility(observations: [observation])
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "observe-digest",
            method: "observe",
            params: .object([:])
        ))

        XCTAssertTrue(response.ok)
        let result = try XCTUnwrap(response.result)
        let decoded = try JSONDecoder().decode(ComputerObservation.self, from: JSONEncoder().encode(result))
        let digest = try XCTUnwrap(decoded.digest)
        XCTAssertEqual(digest, try ObservationDigest.digest(decoded))
        XCTAssertEqual(digest.count, 64)
    }

    func testActionVerifyAXChangedCapturesBaselineBeforeMutationAndWaitsAfterSuccess() async throws {
        let log = VerificationCallLog()
        let handler = RecordingVerificationHandler(log: log)
        let service = ComputerHostService(
            permissions: VerificationPermissions(),
            workspace: VerificationWorkspace(frontmostSequence: [], apps: []),
            actions: ComputerActionService(
                controller: verificationActionController(log: log),
                verification: handler
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "verify-ax",
            method: "click",
            params: .object([
                "x": .number(10),
                "y": .number(10),
                "motionMode": .string("instant"),
                "verify": .object(["kind": .string("ax_changed"), "timeoutMs": .number(50)]),
            ])
        ))

        XCTAssertTrue(response.ok)
        let entries = log.entries
        XCTAssertEqual(entries.first, "baseline-ax")
        XCTAssertEqual(entries.last, "wait-ax:baseline-ax:50")
        let firstEvent = try XCTUnwrap(entries.firstIndex(of: "event"))
        XCTAssertGreaterThan(firstEvent, 0)
        XCTAssertLessThan(firstEvent, entries.count - 1)
    }

    func testActionVerifyScreenRegionCapturesBaselineAndReturnsTimeoutStably() async {
        let log = VerificationCallLog()
        let handler = RecordingVerificationHandler(log: log, screenWaitError: .timeout)
        let service = ComputerHostService(
            permissions: VerificationPermissions(),
            workspace: VerificationWorkspace(frontmostSequence: [], apps: []),
            actions: ComputerActionService(
                controller: verificationActionController(log: log),
                verification: handler
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "verify-screen",
            method: "scroll",
            params: .object([
                "vertical": .number(1),
                "horizontal": .number(0),
                "verify": .object([
                    "kind": .string("screen_region_changed"),
                    "x": .number(10), "y": .number(20),
                    "width": .number(30), "height": .number(40),
                    "timeoutMs": .number(50),
                ]),
            ])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_TIMEOUT")
        let entries = log.entries
        XCTAssertEqual(entries.first, "baseline-screen:10.0,20.0,30.0,40.0")
        XCTAssertEqual(entries.last, "wait-screen:baseline-screen:50")
    }

    func testActionVerifyObjectIsStrict() async {
        let service = ComputerHostService(
            permissions: VerificationPermissions(),
            workspace: VerificationWorkspace(frontmostSequence: [], apps: []),
            actions: ComputerActionService(
                controller: verificationController(),
                verification: FailingVerificationHandler()
            )
        )
        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "verify-strict",
            method: "click",
            params: .object([
                "x": .number(10), "y": .number(10),
                "verify": .object(["kind": .string("ax_changed"), "extra": .bool(true)]),
            ])
        ))
        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID")
    }

    func testVerificationProtocolRejectsUnknownFieldsAndInvalidTimeouts() async {
        let service = ComputerHostService(
            permissions: VerificationPermissions(),
            workspace: VerificationWorkspace(frontmostSequence: [], apps: []),
            actions: ComputerActionService(
                controller: verificationController(),
                verification: FailingVerificationHandler()
            )
        )
        let cases: [(String, JSONValue)] = [
            ("wait_for_frontmost", .object(["bundleIdentifier": .string("com.example.fixture"), "timeoutMs": .number(49)])),
            ("wait_for_text", .object(["text": .string("x"), "extra": .bool(true)])),
            ("wait_until_changed", .object(["baselineDigest": .string("abc"), "timeoutMs": .number(10_001)])),
        ]
        for (method, params) in cases {
            let response = await service.handle(.init(protocolVersion: 1, requestId: method, method: method, params: params))
            XCTAssertFalse(response.ok)
            XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID")
        }
    }
}

private final class VerificationWorkspace: WorkspaceReading, @unchecked Sendable {
    private let lock = NSLock()
    private var sequence: [WorkspaceApplication]
    private let apps: [WorkspaceApplication]
    private var index = 0

    init(frontmostSequence: [WorkspaceApplication], apps: [WorkspaceApplication]) {
        self.sequence = frontmostSequence
        self.apps = apps
    }

    func runningApplications() -> [WorkspaceApplication] { apps }

    func frontmostApplication() -> WorkspaceApplication? {
        lock.lock(); defer { lock.unlock() }
        guard !sequence.isEmpty else { return nil }
        let value = sequence[min(index, sequence.count - 1)]
        index += 1
        return value
    }
}

private final class VerificationAccessibility: AccessibilityReading, @unchecked Sendable {
    private let lock = NSLock()
    private let observations: [ComputerObservation]
    private var index = 0
    private var count = 0

    init(observations: [ComputerObservation]) {
        self.observations = observations
    }

    var observeCount: Int {
        lock.lock(); defer { lock.unlock() }
        return count
    }

    func activeWindow(for application: WorkspaceApplication) throws -> ActiveWindowView {
        ActiveWindowView(application: application.view, title: observations.last?.windowTitle)
    }

    func observe(for application: WorkspaceApplication, limits: ObservationLimits) throws -> ComputerObservation {
        lock.lock(); defer { lock.unlock() }
        guard !observations.isEmpty else { throw NativeVerificationError.failure("missing-observation") }
        count += 1
        let value = observations[min(index, observations.count - 1)]
        index += 1
        return value
    }
}

private actor VerificationScreenDigester: ScreenRegionDigesting {
    private var digests: [String]
    private var bounds: [ComputerBounds] = []

    init(digests: [String]) { self.digests = digests }

    func digest(bounds: ComputerBounds) async throws -> String {
        self.bounds.append(bounds)
        guard !digests.isEmpty else { throw NativeVerificationError.failure("missing-digest") }
        if digests.count == 1 { return digests[0] }
        return digests.removeFirst()
    }

    func requestedBounds() -> [ComputerBounds] { bounds }
}

private struct VerificationSleeper: InputSleeping {
    func sleep(nanoseconds: UInt64) async throws {}
}

private struct VerificationPermissions: PermissionReading {
    func accessibilityTrusted() -> Bool { true }
    func screenCaptureAuthorized() -> Bool { true }
}

private enum NativeVerificationError: Error {
    case failure(String)
}

private struct FailingVerificationHandler: ComputerVerificationHandling {
    func currentAXDigest() throws -> String { throw NativeVerificationError.failure("native-verification-secret") }
    func currentFocusedElementIndex() throws -> Int? { throw NativeVerificationError.failure("native-verification-secret") }
    func waitForFrontmost(_ selector: ComputerApplicationSelector, timeoutMs: Int) async throws -> ApplicationView { throw NativeVerificationError.failure("native-verification-secret") }
    func waitForText(_ text: String, exact: Bool, timeoutMs: Int) async throws { throw NativeVerificationError.failure("native-verification-secret") }
    func waitUntilAXChanged(from baselineDigest: String, timeoutMs: Int) async throws -> String { throw NativeVerificationError.failure("native-verification-secret") }
    func currentScreenRegionDigest(bounds: ComputerBounds) async throws -> String { throw NativeVerificationError.failure("native-verification-secret") }
    func waitUntilScreenRegionChanged(bounds: ComputerBounds, from baselineDigest: String, timeoutMs: Int) async throws -> String { throw NativeVerificationError.failure("native-verification-secret") }
}

private func makeVerificationEngine(
    workspace: VerificationWorkspace = VerificationWorkspace(
        frontmostSequence: [verificationApp(pid: 1, name: "Fixture", bundle: "com.example.fixture", frontmost: true)],
        apps: [verificationApp(pid: 1, name: "Fixture", bundle: "com.example.fixture", frontmost: true)]
    ),
    accessibility: any AccessibilityReading = VerificationAccessibility(observations: [verificationObservation(snapshotId: "default", title: "Ready", focused: false, selected: false)]),
    screenDigester: any ScreenRegionDigesting = VerificationScreenDigester(digests: ["screen"])
) -> ComputerVerificationEngine {
    ComputerVerificationEngine(
        workspace: workspace,
        accessibility: accessibility,
        screenDigester: screenDigester,
        sleeper: VerificationSleeper()
    )
}

private func verificationObservation(
    snapshotId: String,
    title: String,
    focused: Bool,
    selected: Bool,
    description: String? = nil,
    windowTitle: String = "Computer Runtime v2 Fixture"
) -> ComputerObservation {
    ComputerObservation(
        snapshotId: snapshotId,
        application: ApplicationView(name: "Fixture", bundleIdentifier: "com.example.fixture", frontmost: true),
        windowTitle: windowTitle,
        elements: [
            ComputerElementView(
                index: 7,
                role: "AXButton",
                subrole: nil,
                title: title,
                description: description,
                focused: focused,
                enabled: true,
                selected: selected,
                bounds: ComputerBounds(x: 10, y: 10, width: 100, height: 30)
            ),
        ],
        truncated: false
    )
}

private func verificationApp(pid: pid_t, name: String, bundle: String?, frontmost: Bool) -> WorkspaceApplication {
    WorkspaceApplication(processIdentifier: pid, name: name, bundleIdentifier: bundle, frontmost: frontmost)
}

private final class VerificationCallLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []
    var entries: [String] { lock.lock(); defer { lock.unlock() }; return storage }
    func append(_ value: String) { lock.lock(); storage.append(value); lock.unlock() }
}

private struct RecordingVerificationHandler: ComputerVerificationHandling {
    let log: VerificationCallLog
    var screenWaitError: ComputerVerificationError? = nil
    func currentAXDigest() throws -> String { log.append("baseline-ax"); return "baseline-ax" }
    func currentFocusedElementIndex() throws -> Int? { nil }
    func waitForFrontmost(_ selector: ComputerApplicationSelector, timeoutMs: Int) async throws -> ApplicationView { throw ComputerVerificationError.focusFailed }
    func waitForText(_ text: String, exact: Bool, timeoutMs: Int) async throws { log.append("wait-text:\(text):\(timeoutMs)") }
    func waitUntilAXChanged(from baselineDigest: String, timeoutMs: Int) async throws -> String { log.append("wait-ax:\(baselineDigest):\(timeoutMs)"); return "changed-ax" }
    func currentScreenRegionDigest(bounds: ComputerBounds) async throws -> String {
        log.append("baseline-screen:\(bounds.x),\(bounds.y),\(bounds.width),\(bounds.height)")
        return "baseline-screen"
    }
    func waitUntilScreenRegionChanged(bounds: ComputerBounds, from baselineDigest: String, timeoutMs: Int) async throws -> String {
        log.append("wait-screen:\(baselineDigest):\(timeoutMs)")
        if let screenWaitError { throw screenWaitError }
        return "changed-screen"
    }
}

private struct VerificationRecordingSink: InputEventSink {
    let log: VerificationCallLog
    func emit(_ event: InputEvent) throws { log.append("event") }
}

private func verificationActionController(log: VerificationCallLog) -> ComputerInputController {
    ComputerInputController(
        eventSink: VerificationRecordingSink(log: log),
        pointerReader: VerificationPointer(),
        displayTopology: VerificationDisplays(),
        sleeper: VerificationSleeper()
    )
}

private struct VerificationSink: InputEventSink { func emit(_ event: InputEvent) throws {} }
private struct VerificationPointer: PointerReading { func currentPointerPosition() throws -> ComputerPoint { ComputerPoint(x: 10, y: 10) } }
private struct VerificationDisplays: DisplayTopologyReading { func activeDisplayBounds() throws -> [ComputerBounds] { [ComputerBounds(x: 0, y: 0, width: 1000, height: 1000)] } }
private func verificationController() -> ComputerInputController {
    ComputerInputController(
        eventSink: VerificationSink(),
        pointerReader: VerificationPointer(),
        displayTopology: VerificationDisplays(),
        sleeper: VerificationSleeper()
    )
}
