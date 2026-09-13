# chatgpt-system — Active Project State

Last updated: 2026-09-14T01:35+03:00
Status: **Computer-Use-first real-Chrome routing slice is locally GREEN; real-Mac acceptance passed and exact-state publication is next.**

This file is a handoff cache, not the sole source of truth. Resume `chatgpt-system-desktop`, reconcile Git/worktree reality first, then continue from the exact next step below.

## Current goal

When the user explicitly asks for **Computer Use**, physical mouse/keyboard interaction, real Google Chrome, or normal macOS application control, ChatGPT must prefer the `computer_*` surface and operate the real macOS application. Browser Runtime remains available for semantic Playwright automation when Computer Use is not requested or Playwright is explicitly desired.

For real Google Chrome, the canonical Computer Runtime target is bundle identifier `com.google.Chrome`. Chrome for Testing / managed Playwright Chromium must not satisfy an explicit real-Chrome Computer Use request.

## Active workspace

- Authoritative checkout / Continuity worktree: `/Users/dogan/Desktop/chatgpt-system`.
- Continuity alias: `chatgpt-system-desktop`.
- Authoritative checkout is still clean `main` at `54c4e58804f266386fae15be847b012bc7a8f7cd`.
- Managed implementation worktree ID: `519b7494-ba73-4e75-a2de-68bf0ade6ab9`.
- Managed worktree path: `/Users/dogan/.chatgpt-system/worktrees/e4eaca835975a22d75cc3e7778bb895500595d13b544a96d350c557d9edad976/519b7494-ba73-4e75-a2de-68bf0ade6ab9`.
- Active branch: `feat/computer-use-first-real-chrome`.
- `origin/feat/computer-use-bridge` remains intentionally retained at `aca2507210c356fd6d2bc89bb86a1f1dc01719c0`; do not delete or rewrite it without separate classification.

## Why this slice exists

The user ran an explicit prompt asking `@chatgpt-system-local` to use **computer use** for web research and then create a Notes summary. Screenshots showed Google Chrome for Testing instead of the user's normal Google Chrome. Redacted audit metadata independently confirmed the routing failure: the research phase repeatedly used `browser.new_tab`, `browser.navigate`, and `browser.snapshot`; `computer.open_app` appeared only later for the native Notes phase.

Historical guidance also explained the misrouting: the integration runbook said ordinary web semantics should prefer Browser Runtime, while `browser_*` descriptions did not defer an explicit Computer Use request.

## Current state

- Every `browser_*` MCP description now identifies itself as semantic Playwright Browser Runtime and explicitly tells the agent not to use it when the user asks for Computer Use, physical mouse/keyboard interaction, or real Google Chrome/macOS app control; it points to `computer_*` instead.
- `computer_health`, `computer_open_app` / `computer_focus_app`, and `computer_run` now expose the inverse routing guidance to the model.
- Real Google Chrome is identified by exact bundle ID `com.google.Chrome`; metadata explicitly says not to substitute `browser_*` Playwright automation.
- README and `docs/CHATGPT_INTEGRATION.md` now make user intent authoritative over the generic web-semantic preference.
- Existing-Chrome CDP attach remains Browser Runtime and therefore does not count as physical Computer Use.
- No Browser/Computer runtime schema, authority boundary, TCC policy, or product-safety bypass was added.

## Verification

- TDD RED proved the previous browser/computer descriptions and docs lacked the routing contract.
- Focused GREEN: `tests/browser-mcp.test.ts`, `tests/computer-mcp.test.ts`, `tests/chatgpt-integration-docs.test.ts` = `11/11` PASS.
- `git diff --check`: PASS.
- Full branch-local `npm run check`: TypeScript build PASS; `113` test files PASS + `1` intentional skip; `691` tests PASS + `2` intentional skips.
- Live daily-driver was rebuilt/restarted from exact feature commit `97a3758f469d3c2e559815720d7c80b4174bdbf4`; new MCP routing descriptions are active locally.
- Real-Mac acceptance: `computer_open_app(bundleIdentifier="com.google.Chrome")` returned frontmost `Google Chrome` with exact bundle `com.google.Chrome`; fresh Computer Runtime observation confirmed the normal Chrome window/toolbars.
- Reversible physical acceptance clicked the observed address bar through `computer_run` using a fresh semantic/index target, then sent `Escape`; final active window remained real Google Chrome. No CAPTCHA/anti-bot interaction was attempted.
- Content-redacted audit window from acceptance start recorded `computer.open_app=1`, `computer.run=2`, total `computer.*=3`, and **`browser.*=0`**.
- No remote publication has occurred for this slice.

## Completed

- Owner Workstation + Verified Project Session implementation PR #44 merged and was cleaned up.
- Closure/PTY synchronization follow-up PR #45 merged to `54c4e58804f266386fae15be847b012bc7a8f7cd`; local `main` was synchronized and post-merge full tests passed.
- Dynamic Project roots, unattended Keychain/TCC readiness, dual-authority `git_push`, Linux Project Exec portability, ChatGPT developer-MCP recovery guidance, and the 120s Owner Workstation command budget remain part of the merged baseline.

## Next exact step

1. Commit this real-Mac acceptance checkpoint on `feat/computer-use-first-real-chrome` with explicit-path staging.
2. Run fresh full host `npm run check` and production audit on the exact final HEAD.
3. Checkpoint Continuity, take a fresh `project_resume`, then require Linux `project_check run` + independent `report` to return `PASS` for the same clean HEAD/digest.
4. Publish only through typed dual-authority `git_push`, open a PR, verify exact-head Node 22 / Node 24 / macOS native CI, and merge only when GREEN/CLEAN.
5. Fast-forward local `main`, verify post-merge tests, remove only proven-merged feature branch/worktree state, preserve `origin/feat/computer-use-bridge`, and mark Continuity completed.
6. ChatGPT/OpenAI app must use **Refresh** after the tunnel restart so the model sees the new routing descriptions; repeat the user's original-style Web prompt after Refresh as the final product-side acceptance.

## Invariants

- Git/worktree reality outranks Continuity, this handoff file, and older chat context.
- Never reset/clean/revert/delete unfamiliar work.
- Development does not happen on `main`.
- Explicit Computer Use intent must not be silently reinterpreted as Playwright automation.
- Browser Runtime remains available; this slice changes routing guidance, not its authority or safety model.
- The local MCP does not receive the original natural-language prompt as a trusted server-side routing field, so metadata steering is not cryptographic enforcement. If ChatGPT Web still violates the contract after Refresh, stop and design a heavier explicit routing/session gate rather than adding keyword hacks.
- macOS TCC/SIP/FileVault/login/Keychain/sudo/root boundaries remain authoritative.
- `origin/feat/computer-use-bridge` remains preserved until separately classified.

## Blockers / uncertainties

- No local code/test or real-Mac routing blocker remains before publication.
- ChatGPT must Refresh/reload the changed MCP tool descriptions after the completed tunnel restart; local MCP acceptance cannot prove the ChatGPT Web model has reloaded them until that Refresh occurs.
- Final confidence requires an actual ChatGPT Web repeat of the user's original style of Computer Use prompt; local acceptance can prove the real Chrome Computer Runtime path and metadata, but product-side model routing remains controlled by ChatGPT.
