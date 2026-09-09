# Computer Runtime v2 Slice 1 Native Host Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone native macOS helper that exposes strict bounded NDJSON over parent-owned stdio and can report readiness, discover running/frontmost apps, produce bounded AX-first observations, and capture bounded PNG screenshots, without physical input or MCP integration yet.

**Architecture:** Add a separate SwiftPM package under `native/macos-computer-runtime`. `ComputerRuntimeCore` owns protocol/value types and bounded framing; `ComputerRuntimeHostCore` owns permission/app/AX/screenshot services behind testable protocols; the `chatgpt-system-computer-runtime` executable owns stdin/stdout request dispatch only. A packaging script stages the release executable inside a background `.app` bundle with a stable bundle identifier so later slices can install and permission it predictably.

**Tech Stack:** Swift 6, SwiftPM, macOS 14+, Foundation, ApplicationServices Accessibility APIs, AppKit, CoreGraphics, ScreenCaptureKit, Vitest/Node for packaging-plan tests, GitHub Actions macOS runner.

**Spec:** `docs/superpowers/specs/2026-09-09-computer-runtime-v2-design.md`

## Global Constraints

- Slice 1 adds **no physical mouse/keyboard input** and no `computer_*` MCP tools.
- The new helper does not depend on `senoldogann/computer-use`.
- The helper contains no model, planner, OODA loop, plugin manager, browser automation, shell execution, or arbitrary process execution.
- Protocol transport is versioned NDJSON over inherited stdin/stdout; no TCP or Unix listener.
- Protocol version is exactly `1` in this slice.
- Request line limit is `262144` bytes. Oversized/incomplete frames fail closed.
- Observation element limit is `500`; observation serialized-character limit is `262144`.
- Screenshot PNG limit is `8388608` bytes.
- AX observations do not fetch or return `kAXValueAttribute` in Slice 1, so editable/secure current values cannot leak through structured output.
- Raw AX objects, process IDs, raw native error strings, screenshot pixels, and screen text never enter audit because Slice 1 has no audit/MCP integration.
- `health` is passive: Accessibility uses `AXIsProcessTrustedWithOptions` with prompting disabled; Screen Recording uses `CGPreflightScreenCaptureAccess()` and does not request permission.
- Use ScreenCaptureKit for screenshot capture. Apple documents `SCShareableContent` for discovering displays/windows and `SCScreenshotManager` for single-frame capture; the helper therefore has a macOS 14 minimum without changing the existing daemon/broker platform floor.
- Existing Node 22/24 tests and authority/browser/process behavior must remain unchanged.

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

`ComputerRuntimeCore` contains no AppKit/AX/ScreenCaptureKit calls. `ComputerRuntimeHostCore` is the only target that touches macOS host APIs. The executable target contains only process startup and the server loop.

---

### Task 1: Swift package, strict JSON protocol, and bounded NDJSON framing

**Files:**
- Create: `native/macos-computer-runtime/Package.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/JSONValue.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Protocol.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/NDJSONFramer.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeCore/Models.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeCoreTests/ProtocolTests.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeCoreTests/NDJSONFramerTests.swift`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `JSONValue`, `ComputerProtocolRequest`, `ComputerProtocolResponse`, `ComputerProtocolError`, `NDJSONFramer`, `ComputerHealth`, `ApplicationView`, `ActiveWindowView`, `ComputerObservation`, `ComputerElementView`, `ComputerScreenshot`, `ComputerBounds`.
- Consumes: Foundation only.

- [ ] **Step 1: Write protocol and framing RED tests**

Create `ProtocolTests.swift` with concrete round-trip and strict-version expectations:

```swift
import XCTest
@testable import ComputerRuntimeCore

final class ProtocolTests: XCTestCase {
    func testRequestRoundTripsWithProtocolVersionOne() throws {
        let request = ComputerProtocolRequest(
            protocolVersion: 1,
            requestId: "req-1",
            method: "health",
            params: .object([:])
        )
        let data = try JSONEncoder().encode(request)
        XCTAssertEqual(try JSONDecoder().decode(ComputerProtocolRequest.self, from: data), request)
    }

    func testResponseCarriesEitherResultOrError() throws {
        let success = ComputerProtocolResponse.success(
            requestId: "req-1",
            result: .object(["enabled": .bool(true)])
        )
        XCTAssertTrue(success.ok)
        XCTAssertNotNil(success.result)
        XCTAssertNil(success.error)

        let failure = ComputerProtocolResponse.failure(
            requestId: "req-2",
            code: "COMPUTER_PROTOCOL_INVALID",
            message: "Invalid computer runtime request."
        )
        XCTAssertFalse(failure.ok)
        XCTAssertNil(failure.result)
        XCTAssertEqual(failure.error?.code, "COMPUTER_PROTOCOL_INVALID")
    }
}
```

Create `NDJSONFramerTests.swift`:

```swift
import XCTest
@testable import ComputerRuntimeCore

final class NDJSONFramerTests: XCTestCase {
    func testFramerReturnsCompleteLinesAcrossChunks() throws {
        var framer = NDJSONFramer(maxLineBytes: 32)
        XCTAssertEqual(try framer.append(Data("{\"a\":1".utf8)), [])
        let lines = try framer.append(Data("}\n{\"b\":2}\n".utf8))
        XCTAssertEqual(lines.map { String(decoding: $0, as: UTF8.self) }, ["{\"a\":1}", "{\"b\":2}"])
    }

    func testFramerRejectsOversizedLineBeforeNewline() throws {
        var framer = NDJSONFramer(maxLineBytes: 4)
        XCTAssertThrowsError(try framer.append(Data("12345".utf8))) { error in
            XCTAssertEqual(error as? NDJSONFramingError, .lineTooLarge)
        }
    }

    func testFinishRejectsTrailingPartialFrame() throws {
        var framer = NDJSONFramer(maxLineBytes: 32)
        _ = try framer.append(Data("{\"a\":1}".utf8))
        XCTAssertThrowsError(try framer.finish())
    }
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
swift test --package-path native/macos-computer-runtime
```

Expected: compile failure because package/types do not exist yet.

- [ ] **Step 3: Add the SwiftPM package and protocol types**

Create `Package.swift` exactly with separate core/host/executable boundaries:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "chatgpt-system-computer-runtime",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ComputerRuntimeCore", targets: ["ComputerRuntimeCore"]),
        .library(name: "ComputerRuntimeHostCore", targets: ["ComputerRuntimeHostCore"]),
        .executable(
            name: "chatgpt-system-computer-runtime",
            targets: ["ComputerRuntimeHost"]
        ),
    ],
    targets: [
        .target(name: "ComputerRuntimeCore"),
        .target(
            name: "ComputerRuntimeHostCore",
            dependencies: ["ComputerRuntimeCore"]
        ),
        .executableTarget(
            name: "ComputerRuntimeHost",
            dependencies: ["ComputerRuntimeCore", "ComputerRuntimeHostCore"]
        ),
        .testTarget(
            name: "ComputerRuntimeCoreTests",
            dependencies: ["ComputerRuntimeCore"]
        ),
        .testTarget(
            name: "ComputerRuntimeHostCoreTests",
            dependencies: ["ComputerRuntimeCore", "ComputerRuntimeHostCore"]
        ),
    ]
)
```

Implement `JSONValue` as an exhaustive Codable enum, not `[String: Any]`:

```swift
public enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null; return }
        if let bool = try? value.decode(Bool.self) { self = .bool(bool); return }
        if let number = try? value.decode(Double.self) { self = .number(number); return }
        if let string = try? value.decode(String.self) { self = .string(string); return }
        if let array = try? value.decode([JSONValue].self) { self = .array(array); return }
        if let object = try? value.decode([String: JSONValue].self) { self = .object(object); return }
        throw DecodingError.dataCorruptedError(in: value, debugDescription: "Unsupported JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .string(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .object(let item): try value.encode(item)
        }
    }
}
```

`Protocol.swift` must define the stable envelope and helper constructors:

```swift
public struct ComputerProtocolRequest: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let requestId: String
    public let method: String
    public let params: JSONValue
}

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

    public static func failure(
        requestId: String,
        code: String,
        message: String,
        details: JSONValue? = nil
    ) -> Self {
        .init(
            protocolVersion: 1,
            requestId: requestId,
            ok: false,
            result: nil,
            error: .init(code: code, message: message, details: details)
        )
    }
}
```

Add a `JSONValue.fromEncodable(_:)` helper implemented through `JSONEncoder` + `JSONDecoder` so host methods never manually build large response dictionaries.

- [ ] **Step 4: Implement the bounded framer**

`NDJSONFramer` owns an in-memory `Data` buffer, extracts LF-delimited frames, strips one trailing CR, rejects an empty line, rejects any buffered line exceeding the configured byte limit, and rejects non-empty trailing data at EOF:

```swift
public enum NDJSONFramingError: Error, Equatable {
    case lineTooLarge
    case emptyLine
    case incompleteFrame
}

public struct NDJSONFramer {
    private var buffer = Data()
    private let maxLineBytes: Int

    public init(maxLineBytes: Int = 262_144) {
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
            if line.isEmpty { throw NDJSONFramingError.emptyLine }
            if line.count > maxLineBytes { throw NDJSONFramingError.lineTooLarge }
            frames.append(line)
        }

        if buffer.count > maxLineBytes { throw NDJSONFramingError.lineTooLarge }
        return frames
    }

    public mutating func finish() throws {
        guard buffer.isEmpty else { throw NDJSONFramingError.incompleteFrame }
    }
}
```

- [ ] **Step 5: Add response model types with no PID/raw AX fields**

`Models.swift` defines only safe external views:

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

Do **not** add `pid`, raw `value`, `AXUIElement`, pointer identity, or arbitrary dictionaries.

- [ ] **Step 6: Ignore the new Swift build directory and run GREEN tests**

Append only:

```text
native/macos-computer-runtime/.build/
```

to `.gitignore`.

Run:

```bash
swift test --package-path native/macos-computer-runtime
```

Expected: core protocol/framing tests PASS and the empty host targets compile once Task 2 adds their first files. If SwiftPM rejects empty targets during this task, create `ComputerRuntimeHostCore/Module.swift` with `public enum ComputerRuntimeHostCoreModule {}` and `ComputerRuntimeHost/main.swift` with `import ComputerRuntimeHostCore` and an empty `@main` that exits 0; Task 2 replaces the executable body with the real server in the same commit cycle.

- [ ] **Step 7: Commit Task 1**

```bash
git add .gitignore native/macos-computer-runtime
git commit -m "feat: add computer runtime native protocol core"
```

---

### Task 2: Passive readiness, running-app discovery, and strict host dispatch

**Files:**
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/HostProtocols.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemPermissions.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/SystemWorkspace.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/ComputerHostService.swift`
- Create: `native/macos-computer-runtime/Sources/ComputerRuntimeHostCore/NDJSONHostServer.swift`
- Replace: `native/macos-computer-runtime/Sources/ComputerRuntimeHost/main.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/ReadinessTests.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/WorkspaceTests.swift`
- Create: `native/macos-computer-runtime/Tests/ComputerRuntimeHostCoreTests/HostServiceTests.swift`

**Interfaces:**
- Consumes: `ComputerProtocolRequest`, `ComputerProtocolResponse`, `JSONValue`, `ComputerHealth`, `ApplicationView` from Task 1.
- Produces: `PermissionReading`, `WorkspaceReading`, `WorkspaceApplication`, `SystemPermissionReader`, `SystemWorkspaceReader`, `ComputerHostService.handle(_:)`, `NDJSONHostServer.run()`.

- [ ] **Step 1: Write RED tests with fake host adapters**

Define test fakes and expectations:

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
    func frontmostApplication() -> WorkspaceApplication? { apps.first(where: { $0.frontmost }) }
}
```

Tests must assert:

1. `health` returns `state:"running"`, plus the two booleans, and never invokes a permission request method because no such method exists in `PermissionReading`.
2. `list_apps` returns names/bundle IDs/frontmost flags but no process identifier.
3. unknown method returns `COMPUTER_PROTOCOL_INVALID` with generic message.
4. protocolVersion != 1 returns `COMPUTER_PROTOCOL_INVALID`.
5. non-object params for no-argument methods are rejected.

- [ ] **Step 2: Run targeted tests to verify RED**

```bash
swift test --package-path native/macos-computer-runtime --filter ComputerRuntimeHostCoreTests
```

Expected: compile failure for missing host protocols/service.

- [ ] **Step 3: Implement passive permission readers**

`SystemPermissions.swift`:

```swift
import ApplicationServices
import CoreGraphics

public struct SystemPermissionReader: PermissionReading {
    public init() {}

    public func accessibilityTrusted() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    public func screenCaptureAuthorized() -> Bool {
        CGPreflightScreenCaptureAccess()
    }
}
```

Do not call `CGRequestScreenCaptureAccess()` or set the AX prompt option to true in health/readiness paths.

- [ ] **Step 4: Implement app discovery with private internal PID**

`HostProtocols.swift` defines the internal host identity separately from encoded `ApplicationView`:

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

public protocol WorkspaceReading: Sendable {
    func runningApplications() -> [WorkspaceApplication]
    func frontmostApplication() -> WorkspaceApplication?
}
```

`SystemWorkspaceReader` uses `NSWorkspace.shared.runningApplications` and `frontmostApplication`. Filter out terminated applications and empty names, sort deterministically by `localizedName`, then bundle ID. The PID is retained only in `WorkspaceApplication` for future AX lookup and is never encoded into protocol output.

- [ ] **Step 5: Implement strict request dispatch**

`ComputerHostService.handle(_:)` must reject wrong protocol version before method dispatch and require `.object([:])` params for `health`/`list_apps`.

Supported methods after Task 2:

```text
health
list_apps
```

Responses use `JSONValue.fromEncodable(...)` and stable generic errors. Do not embed caught native error descriptions.

- [ ] **Step 6: Implement bounded stdin/stdout server**

`NDJSONHostServer`:

- reads `FileHandle.standardInput` in chunks no larger than 4096 bytes;
- feeds `NDJSONFramer(maxLineBytes: 262_144)`;
- decodes one `ComputerProtocolRequest` per frame;
- sends exactly one compact JSON response plus `\n` for every decodable request;
- malformed JSON produces a generic `COMPUTER_PROTOCOL_INVALID` response using `requestId:"unknown"` because no trusted request ID is available;
- framing errors terminate the helper with non-zero exit rather than trying to resynchronize an oversized stream;
- writes only protocol responses to stdout; diagnostics go to stderr.

`main.swift` becomes:

```swift
import ComputerRuntimeHostCore

@main
struct ComputerRuntimeHost {
    static func main() async {
        let service = ComputerHostService.system()
        let server = NDJSONHostServer(service: service)
        do {
            try await server.run()
        } catch {
            FileHandle.standardError.write(Data("computer runtime host stopped\n".utf8))
            Foundation.exit(1)
        }
    }
}
```

Do not print raw `error` to stderr here; raw native diagnostics can be added behind explicit local debug logging later.

- [ ] **Step 7: Run targeted and full native tests**

```bash
swift test --package-path native/macos-computer-runtime
```

Expected: Task 1 and Task 2 tests PASS.

- [ ] **Step 8: Smoke-test the executable protocol manually**

```bash
printf '%s\n' '{"protocolVersion":1,"requestId":"health-1","method":"health","params":{}}' \
  | swift run --package-path native/macos-computer-runtime chatgpt-system-computer-runtime
```

Expected: one JSON response with matching requestId, `ok:true`, and categorical readiness booleans. The command must not display a permission prompt.

- [ ] **Step 9: Commit Task 2**

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
- Consumes: frontmost `WorkspaceApplication` with private PID.
- Produces: `AccessibilityReading.activeWindow(for:)` and `AccessibilityReading.observe(for:limits:)`; host methods `active_window` and `observe`.

- [ ] **Step 1: Write RED tests for safe observation semantics**

Create a fake `AccessibilityReading` that returns a deterministic `ComputerObservation`. Test:

1. `active_window` returns app name/bundle + title but no PID.
2. `observe` returns snapshot ID and elements.
3. 501 fake elements are truncated to 500 and `truncated:true`.
4. a serialized observation larger than 262144 characters returns `COMPUTER_OUTPUT_LIMIT` rather than a partial malformed object.
5. no `ComputerElementView` field named `value` exists; compile-time model shape enforces redaction.
6. no frontmost app returns `COMPUTER_UNAVAILABLE` with generic text.
7. Accessibility-untrusted path returns `COMPUTER_PERMISSION_REQUIRED`.

- [ ] **Step 2: Run RED tests**

```bash
swift test --package-path native/macos-computer-runtime --filter ObservationTests
```

Expected: compile failure for missing accessibility interfaces.

- [ ] **Step 3: Add `AccessibilityReading` and observation limits**

In `HostProtocols.swift`:

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
    func observe(
        for application: WorkspaceApplication,
        limits: ObservationLimits
    ) throws -> ComputerObservation
}
```

- [ ] **Step 4: Implement `SystemAccessibilityReader` with AX attributes only**

Use `AXUIElementCreateApplication(application.processIdentifier)`. Resolve the focused window using `kAXFocusedWindowAttribute`; if absent, traverse from the app element.

Create small helpers:

```swift
private func copyString(_ element: AXUIElement, _ attribute: CFString) -> String?
private func copyBool(_ element: AXUIElement, _ attribute: CFString) -> Bool?
private func copyElement(_ element: AXUIElement, _ attribute: CFString) -> AXUIElement?
private func copyChildren(_ element: AXUIElement) -> [AXUIElement]
private func copyBounds(_ element: AXUIElement) -> ComputerBounds?
```

Fetch only:

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

**Never call `kAXValueAttribute` in Slice 1.**

Traverse depth-first with:

- maxDepth 12;
- maxElements 500;
- deterministic child order as returned by AX;
- `index` assigned in traversal order starting at 0;
- `truncated=true` as soon as a node/depth budget prevents further traversal.

`AXValueGetValue` decodes `.cgPoint` and `.cgSize` values for bounds. Negative global coordinates are valid on multi-display setups; width/height must be finite and non-negative.

Do not return AX errors verbatim. Map `.apiDisabled`/untrusted state to `COMPUTER_PERMISSION_REQUIRED`; other AX failures become `COMPUTER_UNAVAILABLE` or an internal host error that `ComputerHostService` normalizes generically.

- [ ] **Step 5: Add `active_window` and `observe` dispatch**

Both methods require empty object params in Slice 1 and operate on the frontmost app only.

Before AX access, verify `permissions.accessibilityTrusted()`. If false:

```text
code: COMPUTER_PERMISSION_REQUIRED
message: Accessibility permission is required.
```

After encoding observation to JSON, check serialized character count. If it exceeds 262144, return:

```text
code: COMPUTER_OUTPUT_LIMIT
message: Computer observation exceeded the output limit.
```

Do not silently slice JSON text.

- [ ] **Step 6: Run native tests and a safe local AX smoke**

```bash
swift test --package-path native/macos-computer-runtime
printf '%s\n' '{"protocolVersion":1,"requestId":"obs-1","method":"observe","params":{}}' \
  | swift run --package-path native/macos-computer-runtime chatgpt-system-computer-runtime
```

Expected in CI/untrusted shells: stable `COMPUTER_PERMISSION_REQUIRED`. Expected on an already trusted local helper: bounded observation with no editable values/PIDs.

- [ ] **Step 7: Commit Task 3**

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
- Produces: `ScreenshotCapturing.captureMainDisplay(maxBytes:) async throws -> ComputerScreenshot` and host method `screenshot`.
- Consumes: Screen Recording preflight state from `PermissionReading`.

- [ ] **Step 1: Write RED tests with fake screenshot capturer**

Test:

1. authorized screenshot returns base64, width, height;
2. screen capture not authorized returns `COMPUTER_PERMISSION_REQUIRED` without invoking the capturer;
3. capture result over 8388608 decoded bytes returns `COMPUTER_OUTPUT_LIMIT`;
4. native capture failure returns generic `COMPUTER_UNAVAILABLE` and does not include fake raw error text;
5. screenshot params other than `{}` are rejected in Slice 1.

- [ ] **Step 2: Run RED test**

```bash
swift test --package-path native/macos-computer-runtime --filter ScreenshotTests
```

Expected: compile failure for missing screenshot interface.

- [ ] **Step 3: Implement one-shot main-display capture using ScreenCaptureKit**

`SystemScreenshotCapturer` uses:

```swift
let content = try await SCShareableContent.excludingDesktopWindows(
    false,
    onScreenWindowsOnly: true
)
let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() })
    ?? content.displays.first
```

If no display exists, throw a host-internal unavailable error.

Create:

```swift
let filter = SCContentFilter(
    display: display,
    excludingApplications: [],
    exceptingWindows: []
)
let configuration = SCStreamConfiguration()
configuration.width = display.width
configuration.height = display.height
configuration.showsCursor = true
let image = try await SCScreenshotManager.captureImage(
    contentFilter: filter,
    configuration: configuration
)
```

Convert `CGImage` to PNG in memory using `NSBitmapImageRep(cgImage:)` + `.representation(using: .png, properties: [:])`. Reject empty PNG or `png.count > maxBytes` before base64 encoding.

Return actual `CGImage.width/height`; do not write temporary files.

- [ ] **Step 4: Add screenshot dispatch with passive permission boundary**

Before capture:

```swift
guard permissions.screenCaptureAuthorized() else {
    return .failure(
        requestId: request.requestId,
        code: "COMPUTER_PERMISSION_REQUIRED",
        message: "Screen Recording permission is required."
    )
}
```

Never call `CGRequestScreenCaptureAccess()` from the protocol handler.

- [ ] **Step 5: Run all Swift tests and release build**

```bash
swift test --package-path native/macos-computer-runtime
swift build -c release --package-path native/macos-computer-runtime
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add native/macos-computer-runtime
git commit -m "feat: add computer runtime screenshot capture"
```

---

### Task 5: Stage a stable background `.app` bundle and add build/package scripts

**Files:**
- Create: `scripts/package-macos-computer-runtime.mjs`
- Create: `tests/macos-computer-runtime-package.test.ts`
- Modify: `package.json`
- Modify: `.gitignore` only if staging output is outside the already ignored `.build/` tree.

**Interfaces:**
- Produces: `buildComputerRuntimeBundlePlan(context)`, CLI staging command, npm scripts `build:computer:macos`, `test:computer:macos`, `package:computer:macos`.
- Consumes: release executable from Task 4.

- [ ] **Step 1: Write RED Vitest for bundle-plan invariants**

Test the pure exported planner without executing `swift` or `codesign`:

```ts
import { describe, expect, it } from "vitest";
import { buildComputerRuntimeBundlePlan } from "../scripts/package-macos-computer-runtime.mjs";

describe("computer runtime app bundle plan", () => {
  it("uses a fixed bundle identity and executable name", () => {
    const plan = buildComputerRuntimeBundlePlan({ repoDir: "/repo" });
    expect(plan.bundleIdentifier).toBe("com.senoldogann.chatgpt-system.computer-runtime");
    expect(plan.executableName).toBe("chatgpt-system-computer-runtime");
    expect(plan.bundlePath).toBe("/repo/native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app");
  });

  it("rejects caller overrides for bundle id or executable path", () => {
    expect(() => buildComputerRuntimeBundlePlan({ repoDir: "/repo", bundleIdentifier: "evil" } as never)).toThrow(/Unsupported/);
  });
});
```

- [ ] **Step 2: Run RED test**

```bash
npx vitest run tests/macos-computer-runtime-package.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement deterministic staging script**

The script accepts only:

```text
--output <path>      optional, CI/local staging destination
--sign <identity>    optional; `-` means ad-hoc
--help
```

The pure default plan uses:

```text
bundle name: ChatGPTSystemComputerRuntime.app
bundle id: com.senoldogann.chatgpt-system.computer-runtime
executable: chatgpt-system-computer-runtime
source: native/macos-computer-runtime/.build/release/chatgpt-system-computer-runtime
default output: native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app
```

The generated `Contents/Info.plist` must contain:

```xml
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleExecutable</key><string>chatgpt-system-computer-runtime</string>
<key>CFBundleIdentifier</key><string>com.senoldogann.chatgpt-system.computer-runtime</string>
<key>CFBundleName</key><string>ChatGPTSystemComputerRuntime</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSScreenCaptureUsageDescription</key><string>ChatGPT System uses screen capture only when locally enabled to let the approved computer runtime observe the Mac.</string>
```

Stage through a fresh temporary sibling directory and rename into place so a failed packaging run cannot leave a half-written bundle. Copy executable mode `0755`.

If `--sign` is supplied, run:

```text
/usr/bin/codesign --force --sign <identity> --identifier com.senoldogann.chatgpt-system.computer-runtime <bundle>
```

with `shell:false`. Do not discover or select a signing identity automatically in Slice 1. CI uses `--sign -`; real stable signing/install policy is wired by the setup slice later.

- [ ] **Step 4: Add npm scripts**

Modify `package.json`:

```json
"build:computer:macos": "swift build -c release --package-path native/macos-computer-runtime",
"test:computer:macos": "swift test --package-path native/macos-computer-runtime",
"package:computer:macos": "npm run build:computer:macos && node scripts/package-macos-computer-runtime.mjs --sign -"
```

Do not add dependencies.

- [ ] **Step 5: Run package tests and stage bundle**

```bash
npx vitest run tests/macos-computer-runtime-package.test.ts
npm run test:computer:macos
npm run package:computer:macos
```

Verify:

```bash
app="native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app"
test -x "$app/Contents/MacOS/chatgpt-system-computer-runtime"
plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist"
codesign -dv "$app" 2>&1 | grep 'Identifier=com.senoldogann.chatgpt-system.computer-runtime'
```

Expected bundle ID exactly `com.senoldogann.chatgpt-system.computer-runtime`.

- [ ] **Step 6: Run repository check**

```bash
npm run check
```

Expected: all existing TypeScript tests plus new packaging test PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add package.json package-lock.json scripts/package-macos-computer-runtime.mjs tests/macos-computer-runtime-package.test.ts
git commit -m "build: package macOS computer runtime helper"
```

Do not modify `package-lock.json` unless npm actually changes it; adding scripts alone normally does not.

---

### Task 6: macOS CI gate, protocol smoke, and Slice 1 verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `docs/CHATGPT_INTEGRATION.md`

**Interfaces:**
- Produces: CI proof that the native package builds/tests/packages and protocol health works without requiring TCC permissions.
- Consumes: all Slice 1 artifacts.

- [ ] **Step 1: Extend macOS-native CI**

After the existing authority-broker steps, add:

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

CI must not expect Accessibility or Screen Recording to be granted; it only verifies categorical booleans and protocol shape.

- [ ] **Step 2: Document Slice 1 as internal foundation, not user-ready computer control**

README and ChatGPT integration docs must state:

- Computer Runtime v2 is still disabled/not registered as MCP in Slice 1;
- native helper package path and build/test/package commands;
- macOS 14+ requirement applies to this new helper only;
- health checks are passive and never request TCC permission;
- no physical input exists until Slice 2;
- no `computer_run`/`computer_run_js` exists until later slices.

Do not advertise incomplete tools.

- [ ] **Step 3: Run the complete local verification matrix**

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:computer:macos
npm run package:computer:macos
```

Then protocol checks:

```bash
helper="native/macos-computer-runtime/.build/staged/ChatGPTSystemComputerRuntime.app/Contents/MacOS/chatgpt-system-computer-runtime"
printf '%s\n' '{"protocolVersion":1,"requestId":"health-final","method":"health","params":{}}' | "$helper"
printf '%s\n' '{"protocolVersion":1,"requestId":"apps-final","method":"list_apps","params":{}}' | "$helper"
```

For malformed input:

```bash
printf '%s\n' '{not-json}' | "$helper"
```

Expected: generic protocol error, no crash/backtrace/raw native details.

- [ ] **Step 4: Perform Slice 1 privacy review**

Search source/output schemas for forbidden fields:

```bash
rg -n 'processIdentifier|\bpid\b|kAXValueAttribute|AXUIElement' native/macos-computer-runtime/Sources
```

Expected:

- `processIdentifier` and `AXUIElement` may exist only inside host implementation/internal types;
- `kAXValueAttribute` has **zero** matches;
- protocol models in `ComputerRuntimeCore/Models.swift` contain no PID/raw AX/value field.

Check there is no network listener/shell execution:

```bash
rg -n 'NWListener|Network\.framework|UnixListener|socket\(|Process\(|/bin/sh|shell' native/macos-computer-runtime/Sources
```

Expected: zero matches for listener/shell/process-execution constructs in the helper.

- [ ] **Step 5: Run full `npm run check` and Swift tests one final time**

```bash
npm run check
swift test --package-path native/macos-computer-runtime
```

Expected: GREEN.

- [ ] **Step 6: Commit Task 6**

```bash
git add .github/workflows/ci.yml README.md docs/CHATGPT_INTEGRATION.md
git commit -m "ci: verify computer runtime native foundation"
```

- [ ] **Step 7: Push, open PR, and verify exact-head CI**

Before push:

```bash
git status --short --branch
git rev-parse HEAD
git merge-base HEAD origin/main
```

Push the Slice 1 branch and open a PR titled:

```text
feat: add Computer Runtime v2 native host foundation
```

Record the exact PR head SHA. Require:

```text
test (22)       success
test (24)       success
macos-native    success
```

Do not merge on branch-name assumptions; merge only the verified exact head.

- [ ] **Step 8: Merge and verify post-merge main CI before Slice 2**

After merge:

```bash
git fetch origin
git rev-parse origin/main
```

Verify the merge SHA's push CI is GREEN for Node 22, Node 24, and macOS-native. Only then write/execute the Slice 2 physical-input plan.

---

## Slice 1 definition of done

Slice 1 is complete only when:

- `native/macos-computer-runtime` is a Swift 6/macOS 14+ package;
- its stdio protocol is versioned, strict, byte-bounded, and tested;
- `health` passively reports AX and screen-capture readiness;
- `list_apps` exposes no PID;
- `active_window`/`observe` use AX and never fetch `kAXValueAttribute`;
- observation bounds are enforced before output;
- `screenshot` uses ScreenCaptureKit and enforces the 8 MiB PNG bound;
- the helper writes no screenshots to disk;
- a background `.app` bundle with fixed ID `com.senoldogann.chatgpt-system.computer-runtime` can be staged and ad-hoc signed for CI;
- existing TypeScript behavior remains green;
- macOS-native CI builds/tests/packages the helper and smoke-tests `health` without requiring TCC grants;
- no physical input or MCP registration has slipped into the slice;
- exact-head PR CI and post-merge main CI are green.