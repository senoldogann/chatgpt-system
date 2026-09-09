# Computer Runtime v2 Slice 1 Native Host Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone native macOS helper that exposes strict bounded NDJSON over parent-owned stdio and can report readiness, discover running/frontmost apps, produce bounded AX-first observations, and capture bounded PNG screenshots, without physical input or MCP integration yet.

**Architecture:** Add a separate SwiftPM package under `native/macos-computer-runtime`. `ComputerRuntimeCore` owns protocol/value types and bounded framing; `ComputerRuntimeHostCore` owns permission/app/AX/screenshot services behind testable protocols; the `chatgpt-system-computer-runtime` executable owns stdin/stdout dispatch only. A packaging script stages the release executable inside a background `.app` bundle with a fixed bundle identifier so later slices can install and permission it predictably.

**Tech Stack:** Swift 6, SwiftPM, macOS 14+, Foundation, ApplicationServices Accessibility APIs, AppKit, CoreGraphics, ScreenCaptureKit, Vitest/Node for bundle-plan tests, GitHub Actions macOS runner.

**Spec:** `docs/superpowers/specs/2026-09-09-computer-runtime-v2-design.md`

## Global Constraints

- Slice 1 adds **no physical mouse/keyboard input** and no `computer_*` MCP tools.
- The new helper does not depend on `senoldogann/computer-use`.
- The helper contains no model, planner, OODA loop, plugin manager, shell execution, arbitrary process execution, or network listener.
- Protocol transport is versioned NDJSON over inherited stdin/stdout only.
- Protocol version is exactly `1`.
- Maximum request line is `262144` bytes.
- Maximum response line is `12582912` bytes (12 MiB), large enough for one 8 MiB PNG after base64 plus JSON framing.
- Maximum running-app results is `128`.
- Maximum string field length in native structured output is `4096` characters.
- Observation element limit is `500`; observation serialized-character limit is `262144`; traversal depth limit is `12`.
- Screenshot PNG limit is `8388608` bytes before base64 encoding.
- AX observations never fetch `kAXValueAttribute` in Slice 1.
- Raw AX objects, process IDs, native exception text, screenshot pixels, or screen text are never copied into stable error payloads.
- `health` is passive: Accessibility uses `AXIsProcessTrustedWithOptions` with prompting disabled; Screen Recording uses `CGPreflightScreenCaptureAccess()` and never requests permission.
- Use ScreenCaptureKit for screenshot capture. The new computer helper has a macOS 14 minimum; this does not change the existing daemon/authority-broker floor.
- Existing Node 22/24 tests and authority/browser/process behavior remain unchanged.

---

## File structure locked for Slice 1

```text
native/macos-computer-runtime/
  Package.swift
  Sources/
    ComputerRuntimeCore/
      JSONValue.swift
      Protocol.swift
      NDJSONFramer.swift
      Models.swift
    ComputerRuntimeHostCore/
      HostProtocols.swift
      SystemPermissions.swift
      SystemWorkspace.swift
      SystemAccessibility.swift
      SystemScreenshot.swift
      ComputerHostService.swift
      NDJSONHostServer.swift
    ComputerRuntimeHost/
      main.swift
  Tests/
    ComputerRuntimeCoreTests/
      ProtocolTests.swift
      NDJSONFramerTests.swift
    ComputerRuntimeHostCoreTests/
      ReadinessTests.swift
      WorkspaceTests.swift
      ObservationTests.swift
      ScreenshotTests.swift
      HostServiceTests.swift

scripts/
  package-macos-computer-runtime.mjs

tests/
  macos-computer-runtime-package.test.ts
```

`ComputerRuntimeCore` contains no AppKit/AX/ScreenCaptureKit calls. `ComputerRuntimeHostCore` is the only target that touches host APIs. The executable target contains only process startup and the server loop.

---

### Task 1: Swift package, strict protocol model, and bounded NDJSON framing

**Files:**
- Create: `native/macos-computer-runtime/Package.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/JSONValue.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Protocol.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/NDJSONFramer.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHost/main.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeCoreTests/ProtocolTests.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeCoreTests/NDJSONFramerTests.swift`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `JSONValue`, `ComputerProtocolRequest.decodeStrict(from:)`, `ComputerProtocolResponse`, `ComputerProtocolError`, `NDJSONFramer`, safe external view structs.
- Consumes: Foundation only.

- [ ] **Step 1: Write RED protocol/framing tests**

`ProtocolTests.swift` must include these exact behaviors:

```swift
import XCTest
@testable import ComputerRuntimeCore

final class ProtocolTests: XCTestCase {
    func testStrictRequestAcceptsExactEnvelope() throws {
        let data = Data(#"{"protocolVersion":1,"requestId":"req-1","method":"health","params":{}}"#.utf8)
        let request = try ComputerProtocolRequest.decodeStrict(from: data)
        XCTAssertEqual(request.protocolVersion, 1)
        XCTAssertEqual(request.requestId, "req-1")
        XCTAssertEqual(request.method, "health")
        XCTAssertEqual(request.params, .object([:]))
    }

    func testStrictRequestRejectsUnknownTopLevelField() throws {
        let data = Data(#"{"protocolVersion":1,"requestId":"req-1","method":"health","params":{},"extra":true}"#.utf8)
        XCTAssertThrowsError(try ComputerProtocolRequest.decodeStrict(from: data))
    }

    func testResponseCarriesEitherResultOrError() {
        let ok = ComputerProtocolResponse.success(requestId: "r1", result: .object(["ready": .bool(true)]))
        XCTAssertTrue(ok.ok)
        XCTAssertNotNil(ok.result)
        XCTAssertNil(ok.error)

        let failed = ComputerProtocolResponse.failure(
            requestId: "r2",
            code: "COMPUTER_PROTOCOL_INVALID",
            message: "Invalid computer runtime request."
        )
        XCTAssertFalse(failed.ok)
        XCTAssertNil(failed.result)
        XCTAssertEqual(failed.error?.code, "COMPUTER_PROTOCOL_INVALID")
    }
}
```

`NDJSONFramerTests.swift`:

```swift
import XCTest
@testable import ComputerRuntimeCore

final class NDJSONFramerTests: XCTestCase {
    func testReturnsCompleteLinesAcrossChunks() throws {
        var framer = NDJSONFramer(maxLineBytes: 32)
        XCTAssertEqual(try framer.append(Data("{\"a\":1".utf8)), [])
        let frames = try framer.append(Data("}\n{\"b\":2}\n".utf8))
        XCTAssertEqual(frames.map { String(decoding: $0, as: UTF8.self) }, ["{\"a\":1}", "{\"b\":2}"])
    }

    func testRejectsOversizedLineBeforeNewline() throws {
        var framer = NDJSONFramer(maxLineBytes: 4)
        XCTAssertThrowsError(try framer.append(Data("12345".utf8))) { error in
            XCTAssertEqual(error as? NDJSONFramingError, .lineTooLarge)
        }
    }

    func testRejectsEmptyLineAndTrailingPartialFrame() throws {
        var empty = NDJSONFramer(maxLineBytes: 32)
        XCTAssertThrowsError(try empty.append(Data("\n".utf8)))

        var partial = NDJSONFramer(maxLineBytes: 32)
        _ = try partial.append(Data("{\"a\":1}".utf8))
        XCTAssertThrowsError(try partial.finish())
    }
}
```

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime
```

Expected: package/types missing.

- [ ] **Step 3: Create SwiftPM package with all final target names**

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "chatgpt-system-computer-runtime",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ComputerRuntimeCore", targets: ["ComputerRuntimeCore"]),
        .library(name: "ComputerRuntimeHostCore", targets: ["ComputerRuntimeHostCore"]),
        .executable(name: "chatgpt-system-computer-runtime", targets: ["ComputerRuntimeHost"]),
    ],
    targets: [
        .target(name: "ComputerRuntimeCore"),
        .target(name: "ComputerRuntimeHostCore", dependencies: ["ComputerRuntimeCore"]),
        .executableTarget(name: "ComputerRuntimeHost", dependencies: ["ComputerRuntimeCore", "ComputerRuntimeHostCore"]),
        .testTarget(name: "ComputerRuntimeCoreTests", dependencies: ["ComputerRuntimeCore"]),
        .testTarget(name: "ComputerRuntimeHostCoreTests", dependencies: ["ComputerRuntimeCore", "ComputerRuntimeHostCore"]),
    ]
)
```

Create `HostProtocols.swift` initially with the concrete empty namespace required to make the target non-empty:

```swift
public enum ComputerRuntimeHostCoreModule {}
```

Create `main.swift` initially as a valid executable that exits successfully and writes nothing:

```swift
import ComputerRuntimeHostCore

@main
struct ComputerRuntimeHost {
    static func main() {
        _ = ComputerRuntimeHostCoreModule.self
    }
}
```

Task 2 replaces this executable body with the real server. This is intentional staged TDD, not an unfinished production behavior.

- [ ] **Step 4: Implement `JSONValue` and strict request decoding**

`JSONValue` is an exhaustive Codable enum (`null`, `bool`, `number`, `string`, `array`, `object`) with no `[String: Any]` escape hatch.

`ComputerProtocolRequest` fields:

```swift
public struct ComputerProtocolRequest: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let requestId: String
    public let method: String
    public let params: JSONValue
}
```

Implement `decodeStrict(from:)` by decoding the frame into `JSONValue` first, requiring an object whose key set is **exactly**:

```swift
Set(["protocolVersion", "requestId", "method", "params"])
```

Then decode the same data into `ComputerProtocolRequest`. Reject missing or extra top-level fields. Method-specific param strictness is added in Task 2.

Add `JSONValue.fromEncodable<T: Encodable>(_:)` using `JSONEncoder` then `JSONDecoder` so host services can convert typed result models without hand-built dictionaries.

- [ ] **Step 5: Implement response envelope**

```swift
public struct ComputerProtocolError: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
    public let details: JSONValue?
}

public struct ComputerProtocolResponse: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let requestId: String
    public let ok: Bool
    public let result: JSONValue?
    public let error: ComputerProtocolError?

    public static func success(requestId: String, result: JSONValue) -> Self {
        .init(protocolVersion: 1, requestId: requestId, ok: true, result: result, error: nil)
    }

    public static func failure(requestId: String, code: String, message: String, details: JSONValue? = nil) -> Self {
        .init(protocolVersion: 1, requestId: requestId, ok: false, result: nil,
              error: .init(code: code, message: message, details: details))
    }
}
```

- [ ] **Step 6: Implement bounded framer**

```swift
public enum NDJSONFramingError: Error, Equatable {
    case lineTooLarge
    case emptyLine
    case incompleteFrame
}

public struct NDJSONFramer {
    private var buffer = Data()
    private let maxLineBytes: Int

    public init(maxLineBytes: Int) {
        precondition(maxLineBytes > 0)
        self.maxLineBytes = maxLineBytes
    }

    public mutating func append(_ data: Data) throws -> [Data] {
        buffer.append(data)
        var frames: [Data] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            var line = Data(buffer[..<newline])
            buffer.removeSubrange(...newline)
            if line.last == 0x0D { line.removeLast() }
            guard !line.isEmpty else { throw NDJSONFramingError.emptyLine }
            guard line.count <= maxLineBytes else { throw NDJSONFramingError.lineTooLarge }
            frames.append(line)
        }
        guard buffer.count <= maxLineBytes else { throw NDJSONFramingError.lineTooLarge }
        return frames
    }

    public mutating func finish() throws {
        guard buffer.isEmpty else { throw NDJSONFramingError.incompleteFrame }
    }
}
```

- [ ] **Step 7: Add safe external models**

`Models.swift` must define:

```swift
public struct ComputerHealth: Codable, Equatable, Sendable {
    public let state: String
    public let accessibilityTrusted: Bool
    public let screenCaptureAuthorized: Bool
}

public struct ApplicationView: Codable, Equatable, Sendable {
    public let name: String
    public let bundleIdentifier: String?
    public let frontmost: Bool
}

public struct ComputerBounds: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
}

public struct ComputerElementView: Codable, Equatable, Sendable {
    public let index: Int
    public let role: String
    public let subrole: String?
    public let title: String?
    public let description: String?
    public let focused: Bool?
    public let enabled: Bool?
    public let selected: Bool?
    public let bounds: ComputerBounds?
}

public struct ActiveWindowView: Codable, Equatable, Sendable {
    public let application: ApplicationView
    public let title: String?
}

public struct ComputerObservation: Codable, Equatable, Sendable {
    public let snapshotId: String
    public let application: ApplicationView
    public let windowTitle: String?
    public let elements: [ComputerElementView]
    public let truncated: Bool
}

public struct ComputerScreenshot: Codable, Equatable, Sendable {
    public let pngBase64: String
    public let width: Int
    public let height: Int
}
```

There is deliberately no PID, raw AX identity, or value field.

- [ ] **Step 8: Ignore build output and run GREEN**

Append:

```text
native/macos-computer-runtime/.build/
```

to `.gitignore`.

Run:

```bash
swift test --package-path native/macos-computer-runtime
```

Expected: Task 1 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add .gitignore native/macos-computer-runtime
git commit -m "feat: add computer runtime native protocol core"
```

---

### Task 2: Passive readiness, bounded app discovery, and strict host server

**Files:**
- Replace: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemPermissions.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemWorkspace.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/NDJSONHostServer.swift`
- Replace: `native/macos-computer-runtime/Sources/ComputerRuntimeHost/main.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ReadinessTests.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/WorkspaceTests.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/HostServiceTests.swift`

**Interfaces:**
- Produces: `PermissionReading`, `WorkspaceReading`, `WorkspaceApplication`, `SystemPermissionReader`, `SystemWorkspaceReader`, `ComputerHostService.handle(_:)`, `NDJSONHostServer.run()`.
- Consumes: protocol/models from Task 1.

- [ ] **Step 1: Write RED tests with fake adapters**

Use fakes:

```swift
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
```

Test:

- `health` returns state `running` plus both booleans;
- `list_apps` returns at most 128 apps;
- names/bundle IDs are capped at 4096 characters;
- output contains no process identifier;
- wrong protocolVersion returns `COMPUTER_PROTOCOL_INVALID`;
- unknown method returns `COMPUTER_PROTOCOL_INVALID`;
- `health`/`list_apps` reject params other than an empty object.

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter ComputerRuntimeHostCoreTests
```

- [ ] **Step 3: Define host protocols and private PID identity**

```swift
public struct WorkspaceApplication: Equatable, Sendable {
    public let processIdentifier: pid_t
    public let name: String
    public let bundleIdentifier: String?
    public let frontmost: Bool

    public var view: ApplicationView {
        .init(name: name, bundleIdentifier: bundleIdentifier, frontmost: frontmost)
    }
}

public protocol PermissionReading: Sendable {
    func accessibilityTrusted() -> Bool
    func screenCaptureAuthorized() -> Bool
}

public protocol WorkspaceReading: Sendable {
    func runningApplications() -> [WorkspaceApplication]
    func frontmostApplication() -> WorkspaceApplication?
}
```

PID exists only in this internal host identity and never in encoded models.

- [ ] **Step 4: Implement passive permission checks**

`SystemPermissionReader`:

```swift
import ApplicationServices
import CoreGraphics

public struct SystemPermissionReader: PermissionReading {
    public init() {}

    public func accessibilityTrusted() -> Bool {
        let options = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false
        ] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    public func screenCaptureAuthorized() -> Bool {
        CGPreflightScreenCaptureAccess()
    }
}
```

No request/prompt API is called.

- [ ] **Step 5: Implement bounded workspace discovery**

`SystemWorkspaceReader` reads `NSWorkspace.shared.runningApplications` and `frontmostApplication`, drops terminated/empty-name apps, maps to `WorkspaceApplication`, sorts by name then bundle ID, and lets `ComputerHostService` truncate to 128.

Use a helper:

```swift
func boundedText(_ value: String?, max: Int = 4096) -> String? {
    guard let value else { return nil }
    return String(value.prefix(max))
}
```

Apply it before protocol output.

- [ ] **Step 6: Implement strict method dispatch**

After Task 2 only these methods exist:

```text
health
list_apps
```

`ComputerHostService` checks `protocolVersion == 1`, exact empty-object params for both methods, then converts typed result models through `JSONValue.fromEncodable`.

Stable errors:

```text
COMPUTER_PROTOCOL_INVALID / Invalid computer runtime request.
COMPUTER_OUTPUT_LIMIT / Computer runtime output exceeded the limit.
```

Caught native errors are not embedded into details.

- [ ] **Step 7: Implement request and response byte bounds in `NDJSONHostServer`**

Server behavior:

- read stdin in chunks <= 4096 bytes;
- request `NDJSONFramer(maxLineBytes: 262_144)`;
- decode with `ComputerProtocolRequest.decodeStrict(from:)`;
- encode one compact response followed by LF;
- before write, enforce encoded response `<= 12_582_912` bytes;
- malformed decodable frame produces generic `COMPUTER_PROTOCOL_INVALID` with `requestId:"unknown"`;
- oversized/incomplete framing terminates non-zero rather than resynchronizing;
- stdout carries protocol only; stderr gets only fixed categorical diagnostics.

- [ ] **Step 8: Replace executable main with server loop**

```swift
import ComputerRuntimeHostCore
import Darwin
import Foundation

@main
struct ComputerRuntimeHost {
    static func main() async {
        let server = NDJSONHostServer(service: ComputerHostService.system())
        do {
            try await server.run()
        } catch {
            FileHandle.standardError.write(Data("computer runtime host stopped\n".utf8))
            exit(1)
        }
    }
}
```

Never print raw `error` here.

- [ ] **Step 9: Run tests and protocol smoke**

```bash
swift test --package-path native/macos-computer-runtime
printf '%s\n' '{"protocolVersion":1,"requestId":"health-1","method":"health","params":{}}' \
  | swift run --package-path native/macos-computer-runtime chatgpt-system-computer-runtime
```

Expected: exactly one valid JSON response, no permission prompt.

- [ ] **Step 10: Commit**

```bash
git add native/macos-computer-runtime
git commit -m "feat: add computer runtime readiness and app discovery"
```

---

### Task 3: AX-first active-window observation with strict redaction and bounds

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemAccessibility.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ObservationTests.swift`
- Modify: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/HostServiceTests.swift`

**Interfaces:**
- Produces: `AccessibilityReading.activeWindow(for:)`, `AccessibilityReading.observe(for:limits:)`, methods `active_window` and `observe`.
- Consumes: frontmost `WorkspaceApplication` private PID and safe output models.

- [ ] **Step 1: Write RED observation tests**

Test with fake `AccessibilityReading`:

- active window returns app + bounded title, no PID;
- observation returns snapshot ID and elements;
- >500 elements are truncated and `truncated:true`;
- text fields are capped at 4096 chars;
- serialized observation >262144 chars returns `COMPUTER_OUTPUT_LIMIT`;
- no frontmost app returns `COMPUTER_UNAVAILABLE`;
- untrusted Accessibility returns `COMPUTER_PERMISSION_REQUIRED` before reader invocation;
- encoded element model has no `value` key.

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter ObservationTests
```

- [ ] **Step 3: Add observation interface and limits**

```swift
public struct ObservationLimits: Sendable {
    public let maxElements: Int
    public let maxSerializedCharacters: Int
    public let maxDepth: Int

    public static let `default` = ObservationLimits(
        maxElements: 500,
        maxSerializedCharacters: 262_144,
        maxDepth: 12
    )
}

public protocol AccessibilityReading: Sendable {
    func activeWindow(for application: WorkspaceApplication) throws -> ActiveWindowView
    func observe(for application: WorkspaceApplication, limits: ObservationLimits) throws -> ComputerObservation
}
```

- [ ] **Step 4: Implement `SystemAccessibilityReader`**

Create application AX root with `AXUIElementCreateApplication(pid)`. Resolve focused window via `kAXFocusedWindowAttribute`; if unavailable, traversal may begin at the app root.

Implement helpers for string, bool, element, children, position, and size attributes. Fetch only:

```text
kAXRoleAttribute
kAXSubroleAttribute
kAXTitleAttribute
kAXDescriptionAttribute
kAXFocusedAttribute
kAXEnabledAttribute
kAXSelectedAttribute
kAXPositionAttribute
kAXSizeAttribute
kAXChildrenAttribute
kAXFocusedWindowAttribute
```

There must be **no call** to `kAXValueAttribute`.

Traverse depth-first with max depth 12 and max elements 500. Assign index in traversal order. Cap title/description/role/subrole at 4096 chars before storing. Bounds decode `.cgPoint` and `.cgSize` through `AXValueGetValue`; finite negative x/y are allowed for multi-display layout, width/height must be finite and non-negative.

Do not expose AX errors. Permission-disabled state maps to `COMPUTER_PERMISSION_REQUIRED`; other failures normalize generically.

- [ ] **Step 5: Add strict `active_window` and `observe` dispatch**

Both accept exactly `{}` params and operate on the frontmost app only in Slice 1.

If AX trust is false:

```text
COMPUTER_PERMISSION_REQUIRED / Accessibility permission is required.
```

After producing observation, JSON-encode it and reject if serialized character count exceeds 262144. Do not slice serialized JSON.

- [ ] **Step 6: Run native tests and safe local smoke**

```bash
swift test --package-path native/macos-computer-runtime
printf '%s\n' '{"protocolVersion":1,"requestId":"obs-1","method":"observe","params":{}}' \
  | swift run --package-path native/macos-computer-runtime chatgpt-system-computer-runtime
```

Expected on untrusted shell: stable permission error. Expected when already trusted: bounded observation with no PID/value fields.

- [ ] **Step 7: Commit**

```bash
git add native/macos-computer-runtime
git commit -m "feat: add AX-first computer observation"
```

---

### Task 4: Bounded ScreenCaptureKit screenshot path

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemScreenshot.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Modify: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ScreenshotTests.swift`

**Interfaces:**
- Produces: `ScreenshotCapturing.captureMainDisplay(maxBytes:) async throws -> ComputerScreenshot`, method `screenshot`.
- Consumes: Screen Recording preflight state.

- [ ] **Step 1: Write RED tests**

Test with a fake capturer:

- authorized capture returns base64 + dimensions;
- unauthorized capture returns `COMPUTER_PERMISSION_REQUIRED` without invoking capturer;
- decoded PNG >8388608 bytes returns `COMPUTER_OUTPUT_LIMIT`;
- raw capturer error text is absent from `COMPUTER_UNAVAILABLE` response;
- params other than `{}` are rejected.

- [ ] **Step 2: Run RED**

```bash
swift test --package-path native/macos-computer-runtime --filter ScreenshotTests
```

- [ ] **Step 3: Implement main-display one-shot capture**

Use:

```swift
let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first
```

Then:

```swift
let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
let configuration = SCStreamConfiguration()
configuration.width = display.width
configuration.height = display.height
configuration.showsCursor = true
let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
```

Convert in memory using `NSBitmapImageRep(cgImage:)` and `.representation(using: .png, properties: [:])`. Reject nil/empty PNG and bytes >8388608 before base64. Return `CGImage.width/height`. Never write image files.

- [ ] **Step 4: Add screenshot dispatch**

Preflight first. If false:

```text
COMPUTER_PERMISSION_REQUIRED / Screen Recording permission is required.
```

Never call `CGRequestScreenCaptureAccess()` inside the protocol method.

- [ ] **Step 5: Run full native tests and release build**

```bash
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
```

- [ ] **Step 6: Commit**

```bash
git add native/macos-computer-runtime
git commit -m "feat: add computer runtime screenshot capture"
```

---

### Task 5: Stage a fixed background `.app` bundle and npm build hooks

**Files:**
- Create: `scripts/package-macos-computer-runtime.mjs`
- Create: `tests/macos-computer-runtime-package.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildComputerRuntimeBundlePlan(context)`, CLI bundle staging, npm scripts `build:computer:macos`, `test:computer:macos`, `package:computer:macos`.
- Consumes: release executable from Task 4.

- [ ] **Step 1: Write RED Vitest**

```ts
import { describe, expect, it } from "vitest";
import { buildComputerRuntimeBundlePlan } from "../scripts/package-macos-computer-runtime.mjs";

describe("computer runtime app bundle plan", () => {
  it("uses fixed identity and executable", () => {
    const plan = buildComputerRuntimeBundlePlan({ repoDir: "/repo" });
    expect(plan.bundleIdentifier).toBe("com.senoldogann.chatgpt-system.computer-runtime");
    expect(plan.executableName).toBe("chatgpt-system-computer-runtime");
    expect(plan.bundlePath).toBe("/repo/native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app");
  });

  it("rejects protected identity overrides", () => {
    expect(() => buildComputerRuntimeBundlePlan({ repoDir: "/repo", bundleIdentifier: "evil" })).toThrow(/Unsupported/);
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/macos-computer-runtime-package.test.ts
```

- [ ] **Step 3: Implement deterministic bundler**

CLI accepts only:

```text
--output <path>
--sign <identity>
--help
```

Fixed plan:

```text
bundle: ChatGPTSystemComputerRuntime.app
bundle id: com.senoldogann.chatgpt-system.computer-runtime
executable: chatgpt-system-computer-runtime
source: native/macos-computer-runtime/.build/release/chatgpt-system-computer-runtime
default output: native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app
```

Generate `Contents/Info.plist` with:

```text
CFBundlePackageType = APPL
CFBundleExecutable = chatgpt-system-computer-runtime
CFBundleIdentifier = com.senoldogann.chatgpt-system.computer-runtime
CFBundleName = ChatGPTSystemComputerRuntime
CFBundleVersion = 1
CFBundleShortVersionString = 0.1.0
LSUIElement = true
LSMinimumSystemVersion = 14.0
NSScreenCaptureUsageDescription = ChatGPT System uses screen capture only when locally enabled to let the approved computer runtime observe the Mac.
```

Stage into a fresh temporary sibling directory, copy executable mode 0755, then rename into final path. Never mutate a partially staged existing bundle in place.

If `--sign` is present, spawn exactly:

```text
/usr/bin/codesign --force --sign <identity> --identifier com.senoldogann.chatgpt-system.computer-runtime <bundle>
```

with `shell:false`. Do not auto-discover a signing identity. CI uses `--sign -`. Stable local install/signing policy is wired in a later setup slice.

- [ ] **Step 4: Add npm scripts**

```json
"build:computer:macos": "swift build -c release --package-path native/macos-computer-runtime",
"test:computer:macos": "swift test --package-path native/macos-computer-runtime",
"package:computer:macos": "npm run build:computer:macos && node scripts/package-macos-computer-runtime.mjs --sign -"
```

No dependency changes.

- [ ] **Step 5: Run tests and stage bundle**

```bash
npx vitest run tests/macos-computer-runtime-package.test.ts
npm run test:computer:macos
npm run package:computer:macos
```

Verify:

```bash
app="native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app"
test -x "$app/Contents/MacOS/chatgpt-system-computer-runtime"
test "$(plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist")" = "com.senoldogann.chatgpt-system.computer-runtime"
codesign -dv "$app" 2>&1 | grep 'Identifier=com.senoldogann.chatgpt-system.computer-runtime'
```

- [ ] **Step 6: Run repository checks**

```bash
npm run check
```

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/package-macos-computer-runtime.mjs tests/macos-computer-runtime-package.test.ts
git commit -m "build: package macOS computer runtime helper"
```

Do not stage `package-lock.json` unless npm actually changed it.

---

### Task 6: CI gate, docs, privacy review, and Slice 1 merge verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**
- Produces: exact CI proof for native build/test/package/protocol health.
- Consumes: all Slice 1 artifacts.

- [ ] **Step 1: Extend macOS-native CI**

Add after existing authority-broker checks:

```yaml
      - name: Test macOS computer runtime
        run: swift test --package-path native/macos-computer-runtime

      - name: Build and package macOS computer runtime
        run: |
          npm run build:computer:macos
          node scripts/package-macos-computer-runtime.mjs --sign - --output "$RUNNER_TEMP/ChatGPTSystemComputerRuntime.app"
          app="$RUNNER_TEMP/ChatGPTSystemComputerRuntime.app"
          test -x "$app/Contents/MacOS/chatgpt-system-computer-runtime"
          test "$(plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist")" = "com.senoldogann.chatgpt-system.computer-runtime"

      - name: Verify computer runtime protocol health
        run: |
          helper="$RUNNER_TEMP/ChatGPTSystemComputerRuntime.app/Contents/MacOS/chatgpt-system-computer-runtime"
          response="$(printf '%s\n' '{"protocolVersion":1,"requestId":"ci-health","method":"health","params":{}}' | "$helper")"
          node -e '
            const r = JSON.parse(process.argv[1]);
            if (r.protocolVersion !== 1 || r.requestId !== "ci-health" || r.ok !== true) process.exit(1);
            if (typeof r.result?.accessibilityTrusted !== "boolean") process.exit(1);
            if (typeof r.result?.screenCaptureAuthorized !== "boolean") process.exit(1);
          ' "$response"
```

CI does not expect TCC grants.

- [ ] **Step 2: Document only what exists in Slice 1**

README/integration docs state:

- helper package/build/test/package commands;
- macOS 14+ requirement for this helper only;
- health checks are passive;
- no physical input exists yet;
- no `computer_*` MCP tools, `computer_run`, or `computer_run_js` are advertised yet.

- [ ] **Step 3: Run complete local verification**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:computer:macos
npm run package:computer:macos
```

Protocol smoke:

```bash
helper="native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app/Contents/MacOS/chatgpt-system-computer-runtime"
printf '%s\n' '{"protocolVersion":1,"requestId":"health-final","method":"health","params":{}}' | "$helper"
printf '%s\n' '{"protocolVersion":1,"requestId":"apps-final","method":"list_apps","params":{}}' | "$helper"
printf '%s\n' '{not-json}' | "$helper"
```

Expected malformed frame result: generic protocol error without stack/native details.

- [ ] **Step 4: Run privacy/surface review**

```bash
rg -n 'processIdentifier|\bpid\b|kAXValueAttribute|AXUIElement' native/macos-computer-runtime/Sources
```

Expected:

- `processIdentifier` / AX types only in host internals;
- **zero** `kAXValueAttribute` matches;
- no PID/raw AX/value fields in `ComputerRuntimeCore/Models.swift`.

Check forbidden listener/process/shell surfaces:

```bash
rg -n 'NWListener|UnixListener|socket\(|Process\(|/bin/sh|child_process|shell' native/macos-computer-runtime/Sources
```

Expected: zero matches.

- [ ] **Step 5: Final GREEN**

```bash
npm run check
swift test --package-path native/macos-computer-runtime
```

- [ ] **Step 6: Commit CI/docs**

```bash
git add .github/workflows/ci.yml README.md docs/CHATGPT_INTEGRATION.md
git commit -m "ci: verify computer runtime native foundation"
```

- [ ] **Step 7: Push PR and lock exact head**

```bash
git status --short --branch
git rev-parse HEAD
git merge-base HEAD origin/main
```

PR title:

```text
feat: add Computer Runtime v2 native host foundation
```

Require exact-head:

```text
test (22)       success
test (24)       success
macos-native    success
```

- [ ] **Step 8: Merge and verify post-merge main before Slice 2**

After merge, fetch and verify `origin/main` merge SHA and its push CI. Do not begin physical-input work until Node 22, Node 24, and macOS-native are all green on the merge commit.

---

## Slice 1 definition of done

- Swift 6/macOS 14+ native package exists with core/host/executable boundaries.
- Protocol requests reject unknown top-level fields and method params are strict.
- Request frame bound is 256 KiB and response bound is 12 MiB.
- `health` passively reports AX/screen-capture readiness.
- `list_apps` is bounded and exposes no PID.
- `active_window` / `observe` use AX and never fetch `kAXValueAttribute`.
- Observation fields/elements/serialized size are bounded.
- `screenshot` uses ScreenCaptureKit and enforces 8 MiB PNG bound before base64.
- Helper writes no screenshot to disk and starts no listener/child process.
- Background `.app` stages with fixed bundle ID `com.senoldogann.chatgpt-system.computer-runtime`.
- Existing TypeScript tests remain green.
- macOS-native CI builds, tests, packages, and smoke-tests health without requiring TCC grants.
- No physical input or MCP registration has slipped into Slice 1.
- Exact-head PR CI and post-merge main CI are green.