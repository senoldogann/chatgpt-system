# Final Hardening Release Design

Date: 2026-09-13
Status: Approved for implementation
Branch: `fix/final-hardening-release`
Base: local `main@5fd7262d7af98f5f1315d38f065ea57b2ad5f5cf`

## 1. Objective

Close the remaining actionable findings from the whole-project deep review without adding new product features. The release must preserve the existing authority model, Owner Runtime behavior, Project sandbox, Browser/Computer capability gates, public MCP schemas unless explicitly noted below, and the current test/CI coverage.

This release contains exactly four hardening work packages:

1. audit side-effect outcome integrity and bounded audit storage;
2. Browser Runtime diagnostic acquisition bounds;
3. Computer Runtime native-helper forced shutdown escalation;
4. fail-closed non-loopback HTTP configuration with explicit operator override.

No unrelated refactor, new execution surface, new authority profile, or new runtime capability is in scope.

## 2. Audit outcome integrity and bounded storage

### Problem

`AuditLogger.run()` currently executes the wrapped operation first and then persists the success audit record. If audit persistence fails after the wrapped operation has completed, the audit exception enters the same catch path as an operation failure. A caller therefore receives an error even though the side effect already happened. Retrying a non-idempotent operation can duplicate the effect.

The JSONL file is append-only with no size bound, so a long-running daily-driver can also grow audit storage indefinitely and make storage exhaustion more likely.

### Design

`AuditLogger.run()` separates **operation outcome** from **audit persistence outcome**.

- If `fn()` succeeds, return its result even if the subsequent audit write fails.
- If `fn()` fails, preserve and rethrow the original operation error even if error-audit persistence also fails.
- `record()` remains the explicit persistence primitive and may reject when storage is unavailable. Callers that intentionally require persistence acknowledgement can still observe that failure.
- `run()` uses an internal best-effort record path so audit storage failure never rewrites the wrapped operation's semantic result.
- Audit write failures are reported only through a content-free diagnostic hook/message; raw event metadata, paths beyond the configured audit destination, credentials, lease values, and operation payloads are not emitted as fallback diagnostics.

Audit storage becomes bounded and serialized:

- fixed active-file budget: **16 MiB**;
- one rotated sibling generation: `<auditFile>.1`;
- before appending a record that would exceed the active budget, rotate the existing active file to `.1`, replacing the previous `.1` if present;
- active and rotated files remain user-private (`0600`) under a user-private parent (`0700`);
- writes through one `AuditLogger` instance are serialized so concurrent records cannot race rotation;
- a single encoded audit line larger than the budget is rejected by `record()` rather than creating an oversized file;
- `run()` still treats that persistence rejection as an audit failure, not as an operation failure.

The audit log remains operational evidence, not a tamper-proof ledger.

## 3. Browser diagnostic acquisition bounds

### Problem

The Playwright backend retains console warning/error text, failed-request error text, URLs, runtime-source URLs, and frame initiator URLs before `BrowserService` applies its public-output truncation/sanitization. Entry count is bounded, but individual retained strings are not. A hostile page can therefore cause avoidable memory pressure inside the daemon even though the eventual MCP output is bounded.

### Design

Bound remote-controlled diagnostic strings **at capture time** in `PlaywrightBrowserBackend`.

Use fixed backend retention ceilings:

- diagnostic free text: **2,048 characters**;
- URL-like strings: **16,384 characters**.

The backend stores only bounded strings in `diagnosticsByPageId`:

- console `message.text()` is truncated before insertion;
- `request.failure().errorText` is truncated before insertion;
- request/response URL, runtime-source URL, and frame initiator URL are bounded before insertion.

`BrowserService` keeps its existing output-layer sanitization and limits as defense in depth. The public browser result schemas and redaction semantics do not change. Entry-count limits remain unchanged. This task does not add a popup/page-count lifecycle policy; that is outside the approved finding.

## 4. Computer native-helper forced shutdown

### Problem

`ComputerNativeSupervisor.closeOwnedHost()` currently performs graceful stdin EOF, waits, sends `SIGTERM`, and waits again. If the permission-bearing helper remains alive, the supervisor returns without a final forced kill. `invalidateRecord()` similarly sends only `SIGTERM` after fatal protocol/client failure.

### Design

Centralize helper termination into one bounded supervisor-owned lifecycle:

1. close the client and end stdin when applicable;
2. wait one `closeGraceMs` interval for graceful EOF shutdown;
3. if still alive, send `SIGTERM`;
4. wait one `closeGraceMs` interval;
5. if still alive, send `SIGKILL`;
6. wait one final bounded `closeGraceMs` interval for the close event, then return without an unbounded wait.

The same termination routine is used for normal supervisor shutdown and fatal record invalidation. Fatal invalidation may start termination asynchronously, but the promise must be handled so no unhandled rejection is possible. Callers never gain PID/signal control; this remains entirely internal lifecycle management.

No native protocol change, TCC identity change, bundle-ID change, or mid-request cancellation protocol is introduced.

## 5. Fail-closed non-loopback HTTP

### Problem

The default listener is loopback and protected by bearer authentication plus localhost Host/Origin validation. A deliberately non-loopback bind currently disables localhost validators and relies only on a code comment that the deployment sits behind an authenticated TLS/reverse-proxy boundary. A mistaken `--host 0.0.0.0` can therefore expose plaintext MCP traffic on a LAN.

### Design

Non-loopback HTTP becomes an explicit two-part opt-in.

- Default behavior: any non-loopback `http.host` is rejected during configuration/startup.
- New explicit operator acknowledgement: `--allow-non-loopback-http` or `CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP=true`.
- The override is valid only for HTTP server mode and does not weaken bearer-token requirements.
- Loopback (`127.0.0.1`, `::1`, `localhost`) continues to work without the override and keeps Host/Origin validation.
- When the override is enabled for a non-loopback host, the runtime still uses plain `node:http`; documentation must state that an authenticated TLS/reverse proxy is mandatory and that the flag acknowledges this external trust boundary.
- The override is reported categorically in config/help only; no secret or proxy credential fields are added.

No built-in TLS termination is added in this release.

## 6. Testing and release gates

Every work package is implemented RED -> GREEN with focused regression tests and its own review/commit gate.

Required focused proofs:

- audit: a completed side effect still returns success when persistence fails; an operation error remains the original error when error-audit persistence fails; concurrent writes rotate deterministically and keep active + `.1` storage bounded;
- browser: oversized console, failure, request/response, runtime-source, and initiator strings are bounded in backend-retained diagnostics before `BrowserService` reads them;
- computer helper: uncooperative fake child receives EOF -> `SIGTERM` -> `SIGKILL`; invalidation also escalates without unhandled rejection; cooperative children are not force-killed;
- HTTP: non-loopback host is rejected by default, explicit CLI/env override permits it, loopback behavior is unchanged, and bearer token remains mandatory.

Final exact-head local gate:

1. `npm run check`;
2. `npm audit --omit=dev`;
3. `CHATGPT_SYSTEM_LONG_OWNER_ACCEPTANCE=1 npx vitest run tests/owner-computer-runtime-phase3-integration.test.ts`;
4. `npx vitest run tests/terminal-pty-real.test.ts`;
5. `swift test --package-path native/macos-computer-runtime`;
6. `git diff --check` and clean worktree after the final state commit.

Publication gate:

- publish only the final hardening branch after local exact-head verification;
- open a PR and require Node 22, Node 24, and macOS-native hosted CI on the exact PR head;
- merge only after exact-head CI is green and merge state is clean;
- synchronize local `main`, rerun fresh post-merge verification, then publish/confirm `origin/main`;
- update Project Continuity to the final v1-complete state.

## 7. Non-goals

- no new Owner Runtime feature;
- no Project/User authority redesign;
- no Browser popup/tab lifecycle redesign;
- no native Computer protocol expansion;
- no built-in HTTPS server or certificate management;
- no audit compliance/tamper-proof ledger claim;
- no dependency upgrade unrelated to these fixes.
