import XCTest
import ComputerRuntimeCore
@testable import ComputerRuntimeHostCore

final class ObservationTests: XCTestCase {
    func testActiveWindowReturnsBoundedSafeView() async throws {
        let app = makeWorkspaceApp(frontmost: true)
        let longTitle = String(repeating: "t", count: 5_000)
        let accessibility = FakeAccessibility(
            activeWindow: ActiveWindowView(
                application: ApplicationView(
                    name: String(repeating: "a", count: 5_000),
                    bundleIdentifier: String(repeating: "b", count: 5_000),
                    frontmost: true
                ),
                title: longTitle
            ),
            observation: makeObservation(app: app)
        )
        let service = makeObservationService(apps: [app], accessibility: accessibility)

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "window-1",
            method: "active_window",
            params: .object([:])
        ))

        XCTAssertTrue(response.ok)
        let view = try decodeObservationResult(ActiveWindowView.self, from: response)
        XCTAssertEqual(view.application.name.count, 4_096)
        XCTAssertEqual(view.application.bundleIdentifier?.count, 4_096)
        XCTAssertEqual(view.title?.count, 4_096)

        let encoded = try JSONEncoder().encode(response)
        let text = String(decoding: encoded, as: UTF8.self)
        XCTAssertFalse(text.contains("processIdentifier"))
        XCTAssertFalse(text.contains("\"pid\""))
    }

    func testObservationBoundsElementsAndStructuredText() async throws {
        let app = makeWorkspaceApp(frontmost: true)
        let longText = String(repeating: "x", count: 5_000)
        let elements = (0..<501).map { index in
            let text = index == 0 ? longText : "item-\(index)"
            return ComputerElementView(
                index: index,
                role: text,
                subrole: text,
                title: text,
                description: text,
                focused: index == 0,
                enabled: true,
                selected: false,
                bounds: nil
            )
        }
        let observation = ComputerObservation(
            snapshotId: String(repeating: "s", count: 5_000),
            application: ApplicationView(name: longText, bundleIdentifier: longText, frontmost: true),
            windowTitle: longText,
            elements: elements,
            truncated: false
        )
        let service = makeObservationService(
            apps: [app],
            accessibility: FakeAccessibility(
                activeWindow: ActiveWindowView(application: app.view, title: "Window"),
                observation: observation
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "observe-1",
            method: "observe",
            params: .object([:])
        ))

        XCTAssertTrue(response.ok)
        let bounded = try decodeObservationResult(ComputerObservation.self, from: response)
        XCTAssertEqual(bounded.elements.count, 500)
        XCTAssertTrue(bounded.truncated)
        XCTAssertEqual(bounded.snapshotId.count, 4_096)
        XCTAssertEqual(bounded.application.name.count, 4_096)
        XCTAssertEqual(bounded.application.bundleIdentifier?.count, 4_096)
        XCTAssertEqual(bounded.windowTitle?.count, 4_096)
        XCTAssertEqual(bounded.elements.first?.role.count, 4_096)
        XCTAssertEqual(bounded.elements.first?.subrole?.count, 4_096)
        XCTAssertEqual(bounded.elements.first?.title?.count, 4_096)
        XCTAssertEqual(bounded.elements.first?.description?.count, 4_096)
    }

    func testObservationRejectsSerializedOutputOverLimit() async {
        let app = makeWorkspaceApp(frontmost: true)
        let largeText = String(repeating: "z", count: 4_096)
        let elements = (0..<500).map { index in
            ComputerElementView(
                index: index,
                role: largeText,
                subrole: largeText,
                title: largeText,
                description: largeText,
                focused: nil,
                enabled: nil,
                selected: nil,
                bounds: nil
            )
        }
        let service = makeObservationService(
            apps: [app],
            accessibility: FakeAccessibility(
                activeWindow: ActiveWindowView(application: app.view, title: nil),
                observation: ComputerObservation(
                    snapshotId: "large",
                    application: app.view,
                    windowTitle: nil,
                    elements: elements,
                    truncated: false
                )
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "observe-large",
            method: "observe",
            params: .object([:])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_OUTPUT_LIMIT")
        XCTAssertEqual(response.error?.message, "Computer runtime output exceeded the limit.")
    }

    func testNoFrontmostApplicationReturnsUnavailable() async {
        let service = makeObservationService(
            apps: [],
            accessibility: FakeAccessibility(
                activeWindow: ActiveWindowView(
                    application: ApplicationView(name: "Unused", bundleIdentifier: nil, frontmost: false),
                    title: nil
                ),
                observation: ComputerObservation(
                    snapshotId: "unused",
                    application: ApplicationView(name: "Unused", bundleIdentifier: nil, frontmost: false),
                    windowTitle: nil,
                    elements: [],
                    truncated: false
                )
            )
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "no-frontmost",
            method: "observe",
            params: .object([:])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_UNAVAILABLE")
        XCTAssertEqual(response.error?.message, "Computer runtime is unavailable.")
    }

    func testUntrustedAccessibilityReturnsPermissionBeforeReaderInvocation() async {
        let app = makeWorkspaceApp(frontmost: true)
        let counter = InvocationCounter()
        let accessibility = FakeAccessibility(
            activeWindow: ActiveWindowView(application: app.view, title: nil),
            observation: makeObservation(app: app),
            counter: counter
        )
        let service = ComputerHostService(
            permissions: ObservationFakePermissions(accessibility: false, screenCapture: false),
            workspace: ObservationFakeWorkspace(apps: [app]),
            accessibility: accessibility
        )

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "permission",
            method: "observe",
            params: .object([:])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_PERMISSION_REQUIRED")
        XCTAssertEqual(response.error?.message, "Accessibility permission is required.")
        XCTAssertEqual(counter.value, 0)
    }

    func testNativeAccessibilityErrorDoesNotLeak() async throws {
        let app = makeWorkspaceApp(frontmost: true)
        let accessibility = FakeAccessibility(
            activeWindow: ActiveWindowView(application: app.view, title: nil),
            observation: makeObservation(app: app),
            shouldThrow: true
        )
        let service = makeObservationService(apps: [app], accessibility: accessibility)

        let response = await service.handle(.init(
            protocolVersion: 1,
            requestId: "native-error",
            method: "observe",
            params: .object([:])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "COMPUTER_UNAVAILABLE")
        let data = try JSONEncoder().encode(response)
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(text.contains("native-secret"))
    }

    func testElementEncodingContainsNoValueField() throws {
        let element = ComputerElementView(
            index: 1,
            role: "AXTextField",
            subrole: nil,
            title: "Field",
            description: nil,
            focused: true,
            enabled: true,
            selected: nil,
            bounds: nil
        )

        let data = try JSONEncoder().encode(element)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertNil(json["value"])
    }

    func testObservationLimitsMatchSliceContract() {
        XCTAssertEqual(ObservationLimits.default.maxElements, 500)
        XCTAssertEqual(ObservationLimits.default.maxSerializedCharacters, 262_144)
        XCTAssertEqual(ObservationLimits.default.maxDepth, 12)
    }

    func testActiveWindowAndObserveRejectNonEmptyParams() async {
        let app = makeWorkspaceApp(frontmost: true)
        let service = makeObservationService(
            apps: [app],
            accessibility: FakeAccessibility(
                activeWindow: ActiveWindowView(application: app.view, title: nil),
                observation: makeObservation(app: app)
            )
        )

        for method in ["active_window", "observe"] {
            let response = await service.handle(.init(
                protocolVersion: 1,
                requestId: "strict-\(method)",
                method: method,
                params: .object(["extra": .bool(true)])
            ))
            XCTAssertFalse(response.ok)
            XCTAssertEqual(response.error?.code, "COMPUTER_PROTOCOL_INVALID")
        }
    }
}

private enum FakeAccessibilityError: Error {
    case failure(String)
}

private final class InvocationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func increment() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    var value: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

private struct FakeAccessibility: AccessibilityReading {
    let activeWindowView: ActiveWindowView
    let observation: ComputerObservation
    let shouldThrow: Bool
    let counter: InvocationCounter?

    init(
        activeWindow: ActiveWindowView,
        observation: ComputerObservation,
        shouldThrow: Bool = false,
        counter: InvocationCounter? = nil
    ) {
        self.activeWindowView = activeWindow
        self.observation = observation
        self.shouldThrow = shouldThrow
        self.counter = counter
    }

    func activeWindow(for application: WorkspaceApplication) throws -> ActiveWindowView {
        counter?.increment()
        if shouldThrow { throw FakeAccessibilityError.failure("native-secret") }
        return activeWindowView
    }

    func observe(for application: WorkspaceApplication, limits: ObservationLimits) throws -> ComputerObservation {
        counter?.increment()
        if shouldThrow { throw FakeAccessibilityError.failure("native-secret") }
        return observation
    }
}

private struct ObservationFakePermissions: PermissionReading {
    let accessibility: Bool
    let screenCapture: Bool

    func accessibilityTrusted() -> Bool { accessibility }
    func screenCaptureAuthorized() -> Bool { screenCapture }
}

private struct ObservationFakeWorkspace: WorkspaceReading {
    let apps: [WorkspaceApplication]

    func runningApplications() -> [WorkspaceApplication] { apps }
    func frontmostApplication() -> WorkspaceApplication? { apps.first(where: \.frontmost) }
}

private func makeWorkspaceApp(frontmost: Bool) -> WorkspaceApplication {
    WorkspaceApplication(
        processIdentifier: 1234,
        name: "Fixture App",
        bundleIdentifier: "com.example.fixture",
        frontmost: frontmost
    )
}

private func makeObservation(app: WorkspaceApplication) -> ComputerObservation {
    ComputerObservation(
        snapshotId: "snapshot-1",
        application: app.view,
        windowTitle: "Fixture Window",
        elements: [
            ComputerElementView(
                index: 0,
                role: "AXWindow",
                subrole: nil,
                title: "Fixture Window",
                description: nil,
                focused: true,
                enabled: true,
                selected: nil,
                bounds: ComputerBounds(x: 10, y: 20, width: 800, height: 600)
            ),
        ],
        truncated: false
    )
}

private func makeObservationService(
    apps: [WorkspaceApplication],
    accessibility: FakeAccessibility
) -> ComputerHostService {
    ComputerHostService(
        permissions: ObservationFakePermissions(accessibility: true, screenCapture: false),
        workspace: ObservationFakeWorkspace(apps: apps),
        accessibility: accessibility
    )
}

private func decodeObservationResult<T: Decodable>(
    _ type: T.Type,
    from response: ComputerProtocolResponse
) throws -> T {
    let result = try XCTUnwrap(response.result)
    let data = try JSONEncoder().encode(result)
    return try JSONDecoder().decode(type, from: data)
}
