# chatgpt-system — Active Project State

Last updated: 2026-09-14T01:49+03:00
Status: **Computer-Use-first real-Chrome routing local engineering is complete; final ChatGPT Web product-side acceptance is pending Refresh + repeat.**

This file is a handoff cache, not the sole source of truth. Resume `chatgpt-system-desktop`, reconcile Git/worktree reality first, then continue from the exact next step below.

## Current goal

Keep the merged Computer-Use-first routing stable and complete the remaining product-side acceptance in ChatGPT Web.

When a user explicitly asks for **Computer Use**, physical mouse/keyboard interaction, real Google Chrome, or normal macOS application control, the agent-facing MCP contract now directs the task to `computer_*` tools. For real Google Chrome the canonical bundle identifier is `com.google.Chrome`. Browser Runtime remains available for semantic Playwright automation when Computer Use is not requested or Playwright is explicitly desired.

## Active workspace

- Authoritative checkout / Continuity worktree: `/Users/dogan/Desktop/chatgpt-system`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Primary implementation PR: `#46`.
- Primary feature head: `8ac9de7ee64ce09c0d03c8eae1aebe8e5486b0f8`.
- Primary squash merge result: `c106c760c8d041f35ab6f2e5f548ffab31006f39`.
- Primary feature branch `feat/computer-use-first-real-chrome` was deleted locally and remotely only after exact merge verification.
- Managed implementation worktree `519b7494-ba73-4e75-a2de-68bf0ade6ab9` was verified same-repository and clean, then removed without `--force`.
- `origin/feat/computer-use-bridge` remains intentionally retained at `aca2507210c356fd6d2bc89bb86a1f1dc01719c0`; do not delete or rewrite it without separate classification.
- A docs-only closure PR may temporarily advance `main` beyond the primary merge SHA above; it contains no runtime implementation change.

## Current state

- Every `browser_*` MCP description identifies itself as semantic Playwright Browser Runtime and explicitly defers explicit Computer Use / physical desktop / real-Chrome intent to `computer_*`.
- Computer Runtime entry-point metadata tells the model to use Computer Runtime for explicit Computer Use and to target real Chrome with `com.google.Chrome` rather than Chrome for Testing / managed Playwright Chromium.
- README and `docs/CHATGPT_INTEGRATION.md` encode the same user-intent-first routing rule.
- Existing-Chrome CDP attach remains Browser Runtime and does not satisfy a request for physical Computer Use.
- Browser Runtime was not removed and no Browser/Computer authority, TCC, SIP, Keychain, sudo/root, or product-safety boundary was weakened.
- The daily-driver tunnel was rebuilt/restarted from the feature implementation before publication, so the local runtime contains the new routing metadata. ChatGPT product UI still needs its own app/tool catalog Refresh to prove it has reloaded that metadata.

## Verification

- TDD RED demonstrated that the previous Browser/Computer tool descriptions and integration docs lacked the explicit routing contract.
- Focused routing GREEN: `tests/browser-mcp.test.ts`, `tests/computer-mcp.test.ts`, and `tests/chatgpt-integration-docs.test.ts` = `11/11` PASS.
- Real-Mac acceptance opened/focused exact bundle `com.google.Chrome`; Computer Runtime observation reported frontmost `Google Chrome` with `bundleIdentifier=com.google.Chrome`.
- Reversible physical acceptance used `computer_run` to click the observed address bar and send `Escape`; final active window remained real Google Chrome. No CAPTCHA/anti-bot interaction was attempted.
- Content-redacted acceptance audit recorded `computer.open_app=1`, `computer.run=2`, total `computer.*=3`, and **`browser.*=0`**.
- Exact primary feature HEAD host `npm run check`: TypeScript build PASS; `113` test files PASS + `1` intentional skip; `691` tests PASS + `2` intentional skips.
- Exact primary feature HEAD Linux `project_check run` + independent `report`: PASS on the same clean HEAD + working-tree digest with `stateChangedDuringRun=false`.
- `npm audit --omit=dev`: `0` vulnerabilities.
- PR #46 exact-head hosted CI: Node 22 SUCCESS x2, Node 24 SUCCESS x2, macOS native SUCCESS x2; merge state was `CLEAN` before merge.
- PR #46 merged exact head `8ac9de7ee64ce09c0d03c8eae1aebe8e5486b0f8` to squash commit `c106c760c8d041f35ab6f2e5f548ffab31006f39`.
- Post-merge local `main` `npm run check`: TypeScript build PASS; `113` test files PASS + `1` intentional skip; `691` tests PASS + `2` intentional skips.
- Post-merge `npm audit --omit=dev`: `0` vulnerabilities.
- Cleanup verification: primary local/remote feature refs absent, managed implementation worktree removed, and `origin/feat/computer-use-bridge` preserved at `aca2507210c356fd6d2bc89bb86a1f1dc01719c0`.

## Completed

- Diagnosed the original failure from both screenshot evidence and redacted local audit: explicit Computer Use web research had been routed to `browser.new_tab` / `browser.navigate` / `browser.snapshot`, producing Chrome for Testing, while Computer Runtime was used only later for Notes.
- Changed agent-facing routing metadata and runbook guidance so explicit Computer Use intent outranks the generic semantic-web preference.
- Standardized real Google Chrome targeting on `com.google.Chrome`.
- Kept Browser Runtime and Existing-Chrome attach as separate semantic automation capabilities.
- Verified the physical real-Chrome path locally with no `browser.*` operations in the acceptance window.
- Published through the verified dual-authority/local-first lifecycle, merged PR #46 after exact-head hosted CI, synchronized local `main`, reran the complete test suite, and cleaned only proven-merged primary feature state.

## Next exact step

1. In the ChatGPT/OpenAI app, **Refresh** the `chatgpt-system` custom app/plugin so the current MCP tool descriptions are reloaded after the tunnel restart.
2. In a standard ChatGPT Web text chat with the custom app selected, repeat an explicit Computer Use request equivalent to: `@chatgpt-system-local computer use kullanarak owner rolünde benim için web'de latest AI news araştır ve Notlar uygulamasında bir özet çıkar.`
3. Acceptance criterion: web navigation must use the real Google Chrome app through `computer_*` / physical Computer Runtime behavior, not Chrome for Testing / `browser_*`; Notes should also use Computer Runtime/native app control.
4. If that product-side repeat passes, record it in Continuity as final product acceptance. No new implementation is required.
5. If ChatGPT Web still chooses `browser_*` after Refresh for an explicit Computer Use prompt, stop and create a separate design/spec for a stronger explicit routing/session gate; do not add keyword hacks or remove Browser Runtime reflexively.

## Invariants

- Git/worktree reality outranks Continuity, this handoff file, and older chat context.
- Never reset, clean, revert, overwrite, or delete another agent's unfamiliar work.
- Development does not happen on `main`.
- Local verification must be fresh for the exact state being published.
- Explicit Computer Use intent must not be silently reinterpreted as Playwright automation.
- Browser Runtime remains a separate capability and is not a substitute for physical Computer Use when the user explicitly requests the latter.
- macOS TCC, SIP, FileVault/login, Keychain authentication, and sudo/root boundaries remain authoritative.
- ChatGPT product-surface/tool-routing restrictions are not bypassed by keyword changes or local fallbacks.
- `origin/feat/computer-use-bridge` remains intentionally preserved until separately classified.

## Blockers / uncertainties

- No local implementation, test, merge, or cleanup blocker remains for this routing slice.
- Final product-side acceptance is pending because only the ChatGPT/OpenAI UI can Refresh/reload the developer MCP tool catalog and demonstrate the model's subsequent routing choice.
- MCP metadata steering is strong guidance, not cryptographic intent enforcement. If the refreshed Web product still violates the explicit Computer Use routing contract, the next work is a separately designed explicit routing/session mechanism.
