# chatgpt-system — Active Project State

Last updated: 2026-09-14T02:24Z
Status: **Computer Use perception reliability implementation is complete through local/native gates and live deployment; real-Web Refresh acceptance is still active.**

This file is a handoff cache, not the sole source of truth. Resume `chatgpt-system-perception-feature`, then reconcile the exact worktree/HEAD before acting. Git/worktree reality outranks this file and older chat context.

## Current goal

Finish Task 8 real-Mac product acceptance for the Computer Use perception-reliability slice, record measured behavior, run exact-final-HEAD publication gates, then publish through the existing verified lifecycle.

The implementation fixes the real failure exposed by ChatGPT Web acceptance: already-running normal Chrome can expose only browser chrome through AX, causing page controls to disappear semantically. The new path classifies AX quality, adds bounded focused-window OCR to weak observations, normalizes the public key contract, keeps visual-point recovery one-shot/bounded, and launches only a stopped real Chrome with renderer accessibility. Existing Chrome is never silently restarted.

## Active workspace

- Repository root: `/Users/dogan/Desktop/chatgpt-system`.
- Implementation worktree: `/Users/dogan/.chatgpt-system/worktrees/e4eaca835975a22d75cc3e7778bb895500595d13b544a96d350c557d9edad976/ae7550f2-7c61-4e71-b590-21a531fd80a7`.
- Implementation branch: `feat/computer-use-perception-reliability`.
- Project Continuity alias: `chatgpt-system-perception-feature`.
- Current implementation HEAD before the pending Task 8 docs commit: `5cb22d7c62cc8e2cbffc2bc5f855abcd19737c0a`.
- Design spec: `docs/superpowers/specs/2026-09-14-computer-use-perception-reliability-design.md`.
- Implementation plan: `docs/superpowers/plans/2026-09-14-computer-use-perception-reliability.md`.
- `origin/feat/computer-use-bridge` remains intentionally retained; do not delete or rewrite it without separate classification.

The implementation worktree also contains pre-existing/unowned changes in:

- `scripts/setup-daily-driver.mjs`
- `tests/setup-daily-driver.test.ts`

Their preserved diff SHA-256 is `47df7fedc5e2f8a98374793c8d6213db2aa6cb0c62358ce863bea76ca52ccc28`. Do not stage, stash, reset, rewrite, or discard them as part of this task.

## Current state

### Implemented behavior

1. `computer_observe` classifies AX quality as `strong`, `partial`, or `weak` and returns bounded `perception` metadata.
2. Chrome reports whether `AXWebArea`-backed web content is accessible. Non-Chrome returns `webContentAccessible: null` explicitly.
3. Weak observations may run automatic OCR only against validated focused-window bounds. The runtime never silently widens this automatic path to full-display OCR.
4. OCR is bounded to 64 candidates, 512 characters/candidate, 8192 aggregate characters; confidence below 0.5 is filtered when present. Fast Vision runs first and accurate Vision may run once only when fast yields zero acceptable candidates.
5. `recommendedTargeting` is `ax`, `ocr`, or `visual-point`. Visual point means fresh screenshot plus at most one explicit verified point attempt; failed points are not blindly repeated.
6. Stopped real `com.google.Chrome` is launched with only `--force-renderer-accessibility=complete`; no temporary profile is created. Already-running Chrome is reused and never silently restarted for accessibility.
7. The public key vocabulary is finite and normalized before native IPC, including `enter -> return`, `esc -> escape`, `backspace -> delete`, navigation/arrow aliases, case normalization for letters/F-keys, and rejection of unknown names.
8. Explicit coordinate verification failure maps to `COMPUTER_NEEDS_REPLAN` rather than entering an automatic coordinate retry loop.
9. TCC, user-takeover, emergency-chord, input-release, CAPTCHA/anti-bot, authority, and Browser-vs-Computer boundaries remain unchanged.
10. Required-nullable perception fields are encoded as JSON null rather than omitted. This includes non-Chrome `webContentAccessible` and unknown OCR `confidence`.

## Completed

- Implementation-plan Tasks 1-7 are implemented and committed on the feature lineage.
- Focused-window selection review defect was reproduced RED, fixed, and covered by regression test.
- Required-nullable perception JSON defect was reproduced live and in RED test, fixed, and verified on the real installed runtime.
- Feature Node runtime and signed native Computer Runtime were deployed through the existing tunnel/installer paths without weakening TCC identity.
- Current implementation lineage passed the broad Node suite, full native suite, production dependency audit, and live non-Chrome output validation.
- The original `tools/list` timeout was separated from local-handler performance by direct local and tunnel measurements.

## Important implementation commits

- `4a71f2a` — classify computer perception capability
- `0fd39bd` — add focused window OCR perception
- `96d1adf` — launch real Chrome with renderer accessibility
- `a121962` — normalize computer key contract
- `7503a64` — bound explicit point recovery
- `5072cf3` — expose bounded computer perception metadata
- `996a81c` — harden computer perception recovery fixtures
- `2854bd7` — prefer explicitly focused OCR window
- `5cb22d7` — preserve nullable perception fields

The focused-window review fix was found by RED->GREEN review: `focused=nil` previously outranked a later explicit `focused=true` AXWindow. The corrected selector prefers only `focused == true`, then falls back to the first AXWindow.

The nullable-output fix was found during live non-Chrome acceptance. Swift synthesized `Codable` omitted nil `webContentAccessible` and nil OCR `confidence`, while the MCP schema requires those fields as nullable. Explicit `encodeNil` now preserves the public JSON contract.

## Verification

Evidence tied to the current implementation lineage:

- `git diff --check` passed on the reviewed implementation changes.
- `npm run check` on `5cb22d7`: **113 test files passed, 1 skipped; 696 tests passed, 2 skipped**.
- `npm run test:computer:macos` on `5cb22d7`: **192/192 passed, 0 failures**.
- `PerceptionTests`: **9/9 passed**.
- `ObservationTests`: **10/10 passed**.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- `npm run build`: passed on `5cb22d7`.
- Exact `5cb22d7` release artifact gates passed: `npm run build:computer:macos`, `npm run package:computer:macos`, and `codesign --verify --strict --deep` against the installed helper.

The extra nullable contract test first failed all expected null/key assertions under synthesized encoding, then passed after the explicit encoding fix.

## Live runtime deployment

The Secure MCP Tunnel profile was changed only so its stdio child points to the implementation worktree `dist/cli.js`. A backup of the previous tunnel config exists at:

`~/.config/tunnel-client/chatgpt-system.yaml.pre-perception-2854bd7.bak`

The installed native helper was updated through the repository's identity-preserving installer:

`~/.chatgpt-system/ChatGPTSystemComputerRuntime.app`

Current native executable SHA-256 after `5cb22d7` install:

`0eb7bb07867ab8e3b7186c7bf1068899ffafa86aa46c880d4d496db2dae8cc86`

Signing identity remains `ComputerUse Dev`; the stable designated requirement remained unchanged, and `codesign --verify --strict --deep` passed. TCC identity therefore remained stable.

The daily-driver/tunnel is healthy and its stdio MCP child runs the implementation worktree path. `healthz` and `readyz` returned HTTP 200 (`live` / `ready`).

## `tools/list` timeout diagnosis

The original ChatGPT Web Refresh error was:

`MCP tools/list exceeded the time limit`

Current evidence does **not** support a slow local MCP `tools/list` handler:

- local HTTP `tools/list`: about 62-131 ms in measured runs;
- cold real stdio process initialize + `tools/list`: about 537-644 ms total, with `tools/list` itself about 40-57 ms;
- concurrent 3-second `shell_run` did not serialize the MCP connection; `tools/list` still returned around 57 ms;
- the older tunnel instance recorded one normal sub-500-ms request and one anomalous request around 118 seconds;
- after feature deployment, the first measured remote tunnel `tools/list` completed HTTP 200 in about 386 ms end-to-end.
- on the current deployed instance, a later `computer_observe` surfaced a connector-level HTTP 502 while local `/healthz` and `/readyz` both stayed HTTP 200 and the daily-driver, tunnel-client, and MCP stdio child remained alive;
- the same healthy local instance logged multiple `command response deadline reached; dropping without posting a response` events at roughly two-minute command deadlines, without a local MCP process crash;
- the official `openai/tunnel-client` repository currently has open issue `#57` describing ChatGPT Manual Refresh failure on `v0.0.14` after discovery with no subsequent `main/tools/list`. This is matching external evidence, not proof that every observed timeout has the same root cause.

Current classification: intermittent Secure MCP Tunnel / connector dispatch-path latency, not a demonstrated local `tools/list` performance defect. Do not widen authority or rewrite the local tool catalog without new evidence.

## Real-Mac acceptance status

### Acceptance A — stopped normal Chrome

**Pending by safety constraint.** Chrome is running and must not be force-closed solely for this acceptance. Run this only if Chrome becomes naturally stopped or the user explicitly approves closing it.

### Acceptance B — already-running Chrome with weak web AX

Partially proved:

- Real main Chrome process observed as PID `57947`, start time `2026-09-14 04:13:52` local. The process predates and survives the acceptance work, consistent with the no-restart policy.
- `computer_open_app(com.google.Chrome)` used normal installed Chrome rather than Chrome for Testing.
- Live `computer_observe` returned `webContentAccessible=false`, `axQuality=weak`, `ocrUsed=true`, `recommendedTargeting=ocr`, with bounded focused-window Vision candidates.
- Automatic OCR remained focused-window scoped by implementation and regression tests.
- No `browser.*` operation was used.
- A successful harmless returned-`ocrText` mutation still needs final product acceptance evidence. One screenshot-guided visual point opened the wrong plugin row and was not repeated. A later OCR semantic target attempt failed closed rather than guessing.

### Acceptance C — ChatGPT Web Plugins -> Refresh

**Still active; not yet passed.**

Progress already proved:

- ChatGPT `#settings/Plugins` was reached through physical `computer_*` interaction only.
- Chrome tab zoom was restored from 75% to 100%, after which OCR recognized `chatgpt-system-local` exactly.
- No blind point retry loop was used. One fresh screenshot-derived point attempt selected the wrong row; the same coordinate was not repeated.
- One semantic interaction was blocked by product safety before UI mutation, and another target lookup failed closed.
- A later physical attempt returned `COMPUTER_USER_TAKEOVER`; automation stopped immediately and `computer_release_inputs` completed.
- Audit from the deployed-runtime acceptance window contained **27 `computer.*` actions, 0 `browser.*` actions, and 0 `COMPUTER_PROTOCOL_INVALID` metadata** before the takeover checkpoint. Recorded failure metadata was 2 target-not-found, 1 focus-failed, and 1 user-takeover.
- A later retry semantically selected the existing Chrome `ChatGPT` tab through AX without a coordinate click, but the user moved focus back to MacAgent/T3 Code before the next key action. Two focus-guard failures stopped input before dispatch; the runtime did not fight the user's foreground focus.

The final Refresh click, end-to-end duration, and post-refresh `tools/list` telemetry remain pending because the user is actively using another frontmost application. Do not steal focus while user input is active. A short uninterrupted Chrome-control window is required to finish this acceptance honestly.

## Live non-Chrome regression

A read-only `computer_observe` while `MacAgent` was frontmost first exposed the required-nullable output bug: MCP structured-output validation rejected omitted `webContentAccessible`.

After `5cb22d7` was installed and the runtime renewed, the same live non-Chrome observation succeeded with:

- application bundle: `com.senoldogan.macagent`
- `axQuality=strong`
- `ocrUsed=false`
- `recommendedTargeting=ax`
- `webContentAccessible=null`

This is direct product/runtime evidence for the nullable encoding fix.

## Next exact step

1. Do not touch the user's current MacAgent interaction or approval dialogs.
2. When physical user input has ceased, take a fresh read-only observation/screenshot before resuming Chrome.
3. Re-enter the existing ChatGPT Plugins settings tab without restarting Chrome; keep zoom at 100%.
4. Prefer semantic AX/OCR targeting. If visual fallback is unavoidable, use one fresh screenshot-derived verified point attempt only; never repeat a failed coordinate blindly.
5. Open `chatgpt-system-local`, run **Refresh**, and measure end-to-end duration plus tunnel `tools/list` latency/count. Pass target is under 120 seconds with no browser fallback and no protocol-invalid key calls.
6. Recheck Chrome process identity after the running-Chrome acceptance to prove no restart occurred.
7. Add the final Acceptance B/C results to `docs/CHATGPT_INTEGRATION.md` and this file; do not mark Acceptance A passed unless its precondition is legitimately met.
8. Commit only task-owned documentation paths; never include the two unrelated daily-driver files.
9. Re-run exact-final-HEAD `git diff --check`, `npm run check`, `npm run test:computer:macos`, and `npm audit --omit=dev`.
10. Resume Continuity freshly, run `project_check run` and independent `project_check report` against a clean publication worktree/HEAD, then publish only through typed dual-authority `git_push`, PR/CI, exact-head squash merge, post-merge verification, and cleanup.

## Invariants

- Git/worktree reality outranks Continuity, this file, and older chats.
- Never reset, clean, revert, overwrite, or delete unfamiliar work.
- Do not develop on `main` or the design branch.
- Explicit Computer Use stays on `computer_*`; Browser Runtime is not a substitute.
- Preserve normal Chrome profile/session and do not silently restart running Chrome.
- Automatic OCR stays focused-window-only and bounded.
- No automatic repeated coordinate guesses.
- TCC, SIP, FileVault/login, Keychain auth, user takeover, CAPTCHA/anti-bot, and sudo/root boundaries remain authoritative.
- `origin/feat/computer-use-bridge` remains preserved until separately classified.
- Do not push/merge until product acceptance and final clean-head publication gates agree.

## Blockers / uncertainties

- The user is currently active in another foreground application, so final physical ChatGPT Web Refresh acceptance must wait rather than stealing focus. Resume only when there is a short uninterrupted Chrome-control window.
- Acceptance A requires a legitimately stopped Chrome state or explicit approval to close it.
- The actual Refresh action must still prove whether the earlier intermittent ~118-second tunnel delay reproduces under the current deployed runtime.

## Task 8 exact-HEAD local gate — 2026-09-15

Git/worktree reconciliation now places the implementation branch at exact HEAD `48e60fe8004e5fedc334c9d33c0da7652c475859`. The only remaining unstaged paths are the pre-existing mixed-ownership documentation files plus the preserved daily-driver pair; there are no staged or untracked files.

Task 7 / reliability-v2 completion commits after the earlier live deployment include:

- `723f310` — bounded non-sensitive computer recovery evidence
- `9dbfd1c` — TypeScript/MCP scoped-target and reliability-contract parity
- `bc97501` — reliability-v2 integration documentation contract
- `768a47f` — review fix preserving required-nullable `parentIndex`
- `48e60fe` — broad-gate fixture/catalog alignment for the v2 public contract

The structured review found one correctness issue before the full gate: the approved v2 observation contract specifies `parentIndex: number | null`, but Swift synthesized encoding omitted root `parentIndex` and the TypeScript output schema treated it as optional. RED tests failed in native `ObservationTests` and the MCP schema test, then passed after `768a47f` added explicit JSON null encoding and required-nullable schema validation.

The first exact-HEAD `npm run check` then exposed eight stale broad-suite expectations rather than production regressions: older native fakes still returned `{ state: "completed" }` after the public mutation-result contract changed to `completed_unverified`, and the global HTTP catalog baseline had not classified `computer_scroll_until_visible` as a reliability-v2 tool. Those expectations were updated without weakening runtime validation; the focused five-file rerun passed 34 tests with one intentional long acceptance skip before commit `48e60fe`.

Exact `48e60fe` local verification is GREEN:

- feature diff whitespace check: PASS
- `npm run check`: **113 test files passed, 1 skipped; 707 tests passed, 2 skipped**
- `npm run test:computer:macos`: **214/214 passed, 0 failures**
- `npm audit --omit=dev`: **0 vulnerabilities**
- `npm run build`: PASS
- `npm run build:computer:macos`: PASS
- `npm run package:computer:macos`: PASS, producing the staged ad-hoc app from exact `48e60fe`

Independent reviewer-subagent infrastructure is not available in this chat surface, so no independent-review PASS claim is made. A separate structured spec/diff review was performed and the nullable-parent defect above was found and fixed through RED -> GREEN evidence.

Important deployment boundary: the previously recorded live Mac/tunnel deployment and Acceptance B/C evidence are tied to the older `5cb22d7` lineage. Exact `48e60fe` has been built and packaged locally but has **not** yet been installed/deployed, and final real-Mac Acceptance B/C has therefore **not** been rerun against the exact final local artifact. Do not call the slice complete until deployment identity and live acceptance are tied to the same exact HEAD.

Next exact step from this checkpoint:

1. Reconfirm the preserved daily-driver diff fingerprint before any deploy-side action.
2. Install/deploy exact `48e60fe` only through the existing identity-preserving Computer Runtime/tunnel path; do not restart already-running normal Chrome.
3. Verify installed helper signature/artifact lineage and local/tunnel health before physical UI work.
4. Rerun Acceptance B/C on the exact deployed artifact using `computer_*` only, with fresh observation after uncertain mutations and no repeated blind coordinates/unchanged scrolls.
5. Leave Acceptance A pending unless Chrome is naturally stopped or explicit permission to close it exists.
6. Record exact deployed identity and acceptance evidence, then rerun final exact-HEAD publication gates before any push/PR/merge.

## Task 8 exact deployment and safe acceptance checkpoint — 2026-09-15

The feature branch is at exact HEAD `428da223b6542b93a7fe19d4a04a3592cd4511a7`. The complete local gate set was rerun from a `git archive HEAD` snapshot after the Task 8 state commit and is GREEN: `npm run check` passed 113 test files with 707 tests passed and 2 intentional skips; native tests passed 214/214; production dependency audit found 0 vulnerabilities; TypeScript build, release native build, package, and implementation-range `git diff --check` all passed.

Exact-lineage deployment evidence:

- the native helper was installed from the exact `428da22` archive snapshot through `setup-macos-computer-runtime.mjs`;
- the existing `ComputerUse Dev` signing identity was reused, `tccIdentityStable=true`, and the designated requirement remained `identifier "com.senoldogann.chatgpt-system.computer-runtime" and certificate leaf = H"484f87624db0cea96cf9664e45d99bb7e2db8d4a"`;
- the installed native executable SHA-256 is `446c8cf6ef7f26521ca24918a16ef7a8545a5af8d9a9cfafdda6615d62fa7535`;
- feature-worktree `dist/cli.js`, `dist/computer-runtime.js`, `dist/computer-tool-registration.js`, and `dist/tool-output-schemas.js` were rebuilt and matched the exact archive build byte-for-byte;
- the Secure MCP Tunnel profile was backed up to `~/.config/tunnel-client/chatgpt-system.yaml.pre-reliability-v2-428da22.bak` and its stdio child was moved from the stale main-checkout `dist` to the exact-matching feature-worktree `dist`;
- after LaunchAgent reactivation, the running tunnel child command points to the feature-worktree `dist/cli.js` and local `/healthz` and `/readyz` both return HTTP 200 (`live` / `ready`);
- Computer Runtime readiness remains fully authorized for Accessibility, Screen Capture, event listen, and event post.

Safe Acceptance B/C retry evidence on the exact deployed lineage:

- the current normal Chrome main process is PID `86148`, started `2026-09-15 00:35:21` local, which predates the exact helper/tunnel deployment; this deployment did not restart Chrome;
- an initial read-only Chrome observation again showed weak web AX with focused-window OCR active and the new required-nullable `parentIndex` field present;
- two stale snapshot-index attempts were stopped before physical input and returned bounded recovery evidence rather than clicking stale geometry;
- subsequent semantic `text` and `role` attempts also failed closed with `candidateCount=0`, `activeScrollContainerCount=0`, and `recommendedRecovery=screenshot`; no blind coordinate fallback was executed;
- a fresh screenshot then showed the user actively working in T3 Code rather than Chrome, so foreground acceptance was stopped immediately and runtime-held inputs were released;
- no `browser_*` fallback was used and no coordinate point was clicked during this exact-lineage retry.

Acceptance B/C therefore remains **pending**, not failed: the deployed exact lineage is healthy, but final ChatGPT Plugins -> Refresh interaction must wait for a short uninterrupted Chrome-control window so the runtime does not steal foreground focus. Acceptance A remains pending under the existing stopped-Chrome precondition.
