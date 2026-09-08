# Computer-Use Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the ChatGPT product agent perceive and safely actuate the real Mac through `chatgpt-system` without a secondary API/LLM agent.

**Architecture:** `chatgpt-system` owns authority and spawns an explicitly enabled deterministic Python bridge as a child. The bridge owns the existing Rust actuation driver, authenticates requests with an in-memory startup capability delivered over stdin, and reuses computer-use's typed action, AX, credential, focus, and kill-switch primitives. ChatGPT remains the only reasoning agent.

**Tech Stack:** TypeScript/Node 22+, MCP SDK, Python 3.12, Pydantic, Unix-domain sockets, Rust actuation driver, macOS Accessibility/Screen Recording.

**Spec:** `docs/superpowers/specs/2026-09-08-computer-use-bridge-design.md`

## Global Constraints

- No secondary LLM/API agent.
- No generic shell, arbitrary subprocess, raw PID, signal, environment, backend, or driver-path MCP arguments.
- Computer-use catalog disabled by default and all screen/state/action tools require Admin authority except categorical health.
- Credential/secure-field typing remains fail-closed.
- Focus-sensitive input fails closed when target ownership cannot be proved.
- Global emergency hotkey and human-takeover checks remain active.
- Parent/bridge capability is 256-bit random material kept only in memory and delivered to the bridge over stdin, never argv/env/disk/audit.
- Bridge owns one Rust driver instance locked to bridge UID/PID.
- Request frames and response payloads are bounded; screenshots must be non-empty PNGs.
- Browser/CDP diagnostics, launchd persistence, and root/XPC are not part of this plan.

---

### Task 1: Computer-use deterministic bridge protocol and host controller

**Files:**
- Create: `computer-use/src/computeruse/bridge/__init__.py`
- Create: `computer-use/src/computeruse/bridge/__main__.py`
- Create: `computer-use/src/computeruse/bridge/protocol.py`
- Create: `computer-use/src/computeruse/bridge/controller.py`
- Create: `computer-use/src/computeruse/bridge/server.py`
- Test: `computer-use/tests/smoke/test_bridge_protocol.py`
- Test: `computer-use/tests/smoke/test_bridge_controller.py`

**Interfaces:**
- Produces `BridgeRequest(version: int, capability: str, method: str, params: dict[str, object])` with `MAX_REQUEST_BYTES = 65536`.
- Produces `parse_request_line(raw: bytes) -> BridgeRequest` and `encode_response(...) -> bytes`.
- Produces `BridgeController(driver: ActuationClient, *, url_opener: Callable[[str, str | None], None] | None = None)`.
- Produces `BridgeController.dispatch(method: str, params: dict[str, object]) -> object`.
- Produces stable errors carrying one of `BRIDGE_PROTOCOL_INVALID`, `DRIVER_UNAVAILABLE`, `DRIVER_UNTRUSTED`, `FOCUS_NOT_ACQUIRED`, `CREDENTIAL_ENTRY_REFUSED`, `KILL_SWITCH_TRIPPED`, `TARGET_NOT_FOUND`, `POLICY_DENIED`.

- [ ] **Step 1: Write RED protocol/controller tests**

Tests must assert version/capability/method validation, request-size rejection, URL scheme rejection, secure-field typing refusal, hotkey refusal, focus confirmation, semantic/coordinate target resolution, bounded/redacted AX serialization, screenshot non-empty behavior, and `release_inputs` cleanup on actuation failure.

- [ ] **Step 2: Run RED verification**

Run via PR CI: `uv run ruff check . && uv run pyright && uv run pytest -q --tb=short`.
Expected: existing tests stay green; only new bridge tests fail because bridge modules do not exist.

- [ ] **Step 3: Implement minimal controller**

Use existing canonical primitives instead of copying REPL policy tables:

```python
from computeruse.orchestrator.schemas import MouseClick, MouseDrag, MouseMove, MouseScroll, PressHotkey, TypeText
from computeruse.vision.ax import AXElement, asks_for_a_credential, find_elements, is_secure_field
from computeruse.orchestrator.evidence import Evidence, app_evidence
```

For typing/hotkeys, inspect a fresh target-app AX snapshot before sending input and refuse when `asks_for_a_credential(root)` is true. For click/drag/scroll, resolve either explicit logical coordinates or a unique fresh AX element query/index; ambiguous/stale targets fail instead of guessing. Before focus-sensitive actions, activate and re-read the frontmost identity until confirmed or timeout. Poll driver hotkey state before every mutation and release inputs on mutation error.

`open_url` validates with `urllib.parse.urlsplit` and permits only `http`/`https`; the production opener uses fixed argv (`/usr/bin/open`, optional `-a <app>`, URL) with no shell.

- [ ] **Step 4: Implement bounded AX/screenshot output**

AX output contains only bounded element records:

```python
{"index": 1, "role": "Button", "title": "Save", "value": "", "focused": False,
 "x": 10.0, "y": 20.0, "width": 80.0, "height": 24.0}
```

Secure field values are always empty. Text-entry values are omitted/redacted from bridge output by default so documents, tokens, and form contents are not exported as host diagnostics. Screenshot response carries base64 PNG plus width/height/origin metadata and refuses empty bytes.

- [ ] **Step 5: GREEN verification**

Run full computer-use CI-equivalent commands and require ruff, pyright, pytest, Rust test/clippy, and macOS Rust jobs to pass.

---

### Task 2: Computer-use bridge lifecycle and authenticated Unix socket

**Files:**
- Modify: `computer-use/src/computeruse/bridge/server.py`
- Modify: `computer-use/src/computeruse/bridge/__main__.py`
- Test: `computer-use/tests/smoke/test_bridge_server.py`

**Interfaces:**
- CLI: `python -m computeruse.bridge --socket <absolute> --driver <absolute> [--real]`.
- Startup reads exactly one JSON line from stdin: `{"version":1,"capability":"<64 lowercase hex>"}`.
- Bridge creates an owned driver socket under its private runtime directory, starts the Rust driver with `--allow-pid <bridge-pid>`, and connects through `ActuationClient`.
- Bridge socket accepts one bounded request per connection; every request must carry the exact startup capability using constant-time comparison.

- [ ] **Step 1: Write RED socket/lifecycle tests**

Cover parent `0700`, socket `0600`, symlink/regular-file refusal, owned stale-socket recovery, capability mismatch refusal, malformed startup line refusal, simulated driver lifecycle, and shutdown ordering.

- [ ] **Step 2: Verify RED in CI**

Expected failure is limited to new lifecycle expectations.

- [ ] **Step 3: Implement fail-closed lifecycle**

Shutdown order:

```text
stop accepting -> release_inputs -> close ActuationClient -> terminate owned driver -> remove owned sockets
```

Never scan for or kill arbitrary PIDs after restart.

- [ ] **Step 4: Full GREEN and computer-use PR**

Open `feat/computer-use-bridge -> main`; exact-head CI must be fully green before squash merge.

---

### Task 3: chatgpt-system child manager and bridge client

**Files:**
- Create: `chatgpt-system/src/computer-use-client.ts`
- Create: `chatgpt-system/src/computer-use-runtime.ts`
- Modify: `chatgpt-system/src/config.ts`
- Modify: `chatgpt-system/src/cli-command.ts`
- Modify: `chatgpt-system/src/cli.ts`
- Modify: `chatgpt-system/src/runtime-shutdown.ts`
- Test: `chatgpt-system/tests/computer-use-config.test.ts`
- Test: `chatgpt-system/tests/computer-use-client.test.ts`
- Test: `chatgpt-system/tests/computer-use-runtime.test.ts`

**Interfaces:**
- Config defaults: disabled; socket `~/.chatgpt-system/computer-use/bridge.sock`; timeout `10000ms`.
- CLI adds explicit `--enable-computer-use`, `--computer-use-python <absolute-or-name>`, `--computer-use-root <absolute repo root>`, and `--computer-use-driver <absolute driver>` as operator startup configuration, never MCP arguments.
- `ComputerUseRuntime.start()` generates `randomBytes(32).toString("hex")`, spawns Python with a sanitized environment and `shell:false`, writes startup capability only to child stdin, and owns cleanup.
- `ComputerUseClient` opens the configured Unix socket per request and sends `{version:1, capability, method, params}`.

- [ ] **Step 1: RED tests**

Assert disabled defaults, strict startup config, capability absent from argv/env/logs, bounded request/response, timeout cleanup, malformed response handling, and child shutdown.

- [ ] **Step 2: RED verification**

Run `npm test`/repository check through exact-head CI; only new tests should fail.

- [ ] **Step 3: Implement runtime/client**

No reusable TCP listener, no capability persistence, no bridge auto-start unless explicit enablement is present.

- [ ] **Step 4: GREEN verification**

Require Node 22, Node 24, setup smokes, and native broker CI green.

---

### Task 4: Authority-scoped MCP computer tools

**Files:**
- Modify: `chatgpt-system/src/server.ts`
- Modify: `chatgpt-system/src/scoped-runtime.ts`
- Modify: `chatgpt-system/src/tool-output-schemas.ts`
- Modify: `chatgpt-system/src/errors.ts`
- Modify: `chatgpt-system/src/audit.ts` if needed for categorical metadata only
- Test: `chatgpt-system/tests/computer-use-mcp.test.ts`
- Test: `chatgpt-system/tests/computer-use-audit.test.ts`
- Modify: `chatgpt-system/README.md`
- Modify: `chatgpt-system/SECURITY.md`
- Modify: `chatgpt-system/docs/ARCHITECTURE.md`
- Modify: `chatgpt-system/docs/CHATGPT_INTEGRATION.md`
- Modify: `chatgpt-system/.env.example`

**Interfaces:**
- Public tools: `computer_health`, `computer_active_window`, `computer_list_apps`, `computer_ui_snapshot`, `computer_open_app`, `computer_open_url`, `computer_screenshot`, `computer_click`, `computer_drag`, `computer_scroll`, `computer_type_text`, `computer_press_hotkey`, `computer_release_inputs`.
- `computer_health` is categorical and lease-free; every other tool requires a live Admin lease.
- MCP schemas expose no raw PID, shell, environment, executable, backend, signal, arbitrary subprocess, or capability fields.
- Screenshot returns MCP image content (`image/png`) plus bounded metadata, not base64 in normal prose.

- [ ] **Step 1: RED MCP/audit tests**

Assert Admin success, User/Project `POLICY_DENIED`, strict schemas, image response, stable bridge error mapping, and audit exclusion of typed text, URL query/fragment, screenshot bytes, AX values, coordinates, capability, PIDs, and lease IDs.

- [ ] **Step 2: Implement MCP surface**

`ScopedRuntime` provides an Admin-only computer-use facade backed by the one runtime client. The client is optional; when disabled/unavailable calls fail categorically instead of changing authority semantics.

- [ ] **Step 3: Full exact-head GREEN**

Run the complete repository CI and inspect all jobs, not only aggregate status.

- [ ] **Step 4: chatgpt-system PR and merge**

Open ready PR, record exact head and CI, then squash merge with expected-head guard.

---

### Task 5: Real Mac acceptance and final hardening

**Files:**
- Update docs/tests only if acceptance reveals a reproducible defect.

- [ ] **Step 1: Update local repos/builds**

Use merged `main` in both repos, build the Rust driver, refresh the tunnel profile/build, and start `chatgpt-system` with explicit computer-use enablement.

- [ ] **Step 2: Admin acceptance**

Touch-ID Admin lease must prove health, active window, screenshot, harmless app open, `https` URL open, benign click/type, process cleanup, and lease revocation.

- [ ] **Step 3: Safety acceptance**

User lease cannot inspect/actuate; secure/password-field typing is refused; emergency hotkey prevents subsequent actuation; stopping the MCP runtime cleans up its owned bridge/driver/socket.

- [ ] **Step 4: Final evidence**

If acceptance exposes no code defect, record results only. If it exposes one, reproduce with RED test, fix minimally, rerun exact-head CI, PR, and merge before declaring the subsystem complete.
