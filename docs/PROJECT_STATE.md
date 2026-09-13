# chatgpt-system — Active Project State

Last updated: 2026-09-14T00:48+03:00
Status: **Owner Workstation + Verified Project Session slice is implemented, verified, merged, and cleaned up.**

This file is a handoff cache, not the sole source of truth. Resume `chatgpt-system-desktop`, reconcile Git/worktree reality first, then read any active spec/plan for new work.

## Current goal

Keep the merged Owner Workstation + Verified Project Session slice stable. New implementation work must start from clean synchronized `main` on a non-main branch/worktree and follow the repository local-first lifecycle.

The completed slice provides:

1. explicit Owner Workstation daily-driver mode with full current-user local capability while retaining macOS security boundaries;
2. unattended readiness through stable Computer Runtime identity and non-interactive app-owned Keychain credentials;
3. exact `project_resume` provenance plus fresh local `project_check PASS` before typed publication;
4. dynamic exact Project roots outside bootstrap/default roots without widening Project authority to `/` or the entire home directory;
5. Linux Project Exec verification portability with a bounded Owner Workstation command budget;
6. ChatGPT Web custom-app recovery guidance for conversations where developer MCP availability disappears.

## Active workspace

- Authoritative checkout: `/Users/dogan/Desktop/chatgpt-system`.
- Project Continuity alias: `chatgpt-system-desktop`.
- Primary implementation PR: `#44`.
- Primary feature head: `79087289845674976184a6ae728bc5f89943727e`.
- Primary squash merge result: `7df8082a0758873fcb4a36b6307f41f8ea72e520`.
- Primary feature branch `feat/owner-workstation-verified-project-session` was deleted locally and remotely only after merge verification.
- Managed implementation worktree `71bcabad-7ca8-4a45-8788-fc44ff0e2fcf` was verified clean and removed through the typed worktree lifecycle.
- Historical design spec: `docs/superpowers/specs/2026-09-13-owner-workstation-verified-project-session-design.md`.
- Historical implementation plan: `docs/superpowers/plans/2026-09-13-owner-workstation-verified-project-session.md`.
- `origin/feat/computer-use-bridge` remains intentionally retained at `aca2507210c356fd6d2bc89bb86a1f1dc01719c0`; do not delete or rewrite it without separate classification.

## Completed

- Added explicit `--owner-workstation` preset composing Personal Admin, Owner Runtime, terminal/PTY, Project Exec, Computer Use, and full-host JavaScript. Browser Runtime remains an independent gate and is explicitly enabled on this workstation.
- Added dedicated native Keychain store/read/delete path and passive unattended-readiness reporting without TCC, SIP, FileVault/login, sudo/root, or Keychain-authentication bypass.
- Added bounded in-memory `ContinuityResumeRegistry`; only successful `project_resume` leases prove publication provenance.
- Added fail-closed `ProjectPublishGate`: non-main clean tree, exact resumed worktree identity, and fresh exact-state ProjectCheck PASS are required.
- Hardened typed `git_push` to require active Admin + exact resumed Project authority and to push the exact verified commit SHA.
- Clarified that configured `roots` are bootstrap/default roots, not a permanent repository allowlist. New exact Project roots may be opened with `session_authority_start`, then registered once and resumed later.
- Owner Workstation uses a bounded `120000ms` command timeout; the global secure default remains `60000ms`.
- Added `@rolldown/binding-wasm32-wasi@1.2.8` for cross-platform Vitest startup inside Linux Project Exec.
- Kept Project Exec sandbox security unchanged and moved executable test fixtures from sandbox `/tmp` to ignored `node_modules/.cache/chatgpt-system-test-tmp` after directly proving `/tmp` is non-executable in the sandbox.
- Added ChatGPT Web custom-app recovery contract: `This conversation does not support developer MCPs` is treated as product-surface/tool-routing unavailability, never proof of local daemon failure. Agents must not claim unperformed local work or substitute an unmounted container for the user's Mac.
- Restarted the daily-driver tunnel after final tool metadata changes; current tunnel uses `--owner-workstation --enable-browser` with the existing Keychain-backed credential.
- Published exact verified feature state through typed dual-authority `git_push`, merged PR #44 only after exact-head hosted checks passed, synchronized local `main` with `origin/main`, and cleaned only proven-merged feature state.

## Current state

- Primary implementation is merged into `main` through PR #44.
- Local `main` was fast-forward synchronized to the PR #44 squash merge result and matched `origin/main` at that point.
- No primary implementation worktree or feature branch remains.
- No open PR remained after the primary merge/cleanup verification.
- Owner Workstation live capabilities report dynamic Project roots, Project Exec enabled, Owner Runtime enabled, Computer Use/full-host JS enabled, and `commandTimeoutMs=120000`.
- The ChatGPT-facing tool metadata explains both dynamic-project root semantics and the developer-MCP-unavailable recovery contract.

## Verification

- Final feature HEAD `79087289845674976184a6ae728bc5f89943727e`: host `npm run check` PASS — TypeScript build PASS; `113` test files PASS + `1` intentional skip; `690` tests PASS + `2` intentional skips.
- `npm audit --omit=dev`: `0` vulnerabilities.
- Linux Project Exec executable-fixture regression: affected suites `24/24` PASS on both macOS host and Linux sandbox.
- ChatGPT custom-app recovery metadata/docs tests: `14/14` PASS.
- Final Linux `project_check run` and independent `report`: `PASS` for exact feature HEAD and clean-tree digest `f0af1e1d86a1c7d87a6741fb76deb2ceb20d27ded2019e53949ede9d907c758a`; `stateChangedDuringRun=false`.
- PR #44 hosted CI on exact head: Node 22 PASS, Node 24 PASS, and macOS native PASS across both triggered CI runs; merge state was `CLEAN` before merge.
- PR #44 merged exact head `79087289845674976184a6ae728bc5f89943727e` to squash merge commit `7df8082a0758873fcb4a36b6307f41f8ea72e520`.
- Post-merge local `main` `npm run check`: TypeScript build PASS; `113` test files PASS + `1` intentional skip; `690` tests PASS + `2` intentional skips.
- Cleanup verification: local and remote primary feature refs absent, only the authoritative main worktree remained, open PR list empty, and `origin/feat/computer-use-bridge` remained intact at `aca2507210c356fd6d2bc89bb86a1f1dc01719c0`.

## Next exact step

There is no active implementation task for this slice. For future work:

1. `project_resume("chatgpt-system-desktop")` and reconcile Git/worktree reality.
2. Ensure local `main` is clean and synchronized with `origin/main`.
3. Create a new non-main branch/worktree for the new approved spec/plan.
4. Keep all code/test/build verification local before publication.
5. Preserve `origin/feat/computer-use-bridge` until it is separately classified.

## Invariants

- Git/worktree reality outranks Continuity, this handoff file, and older chat context.
- Never reset, clean, revert, overwrite, or delete another agent's unfamiliar work.
- Development does not happen on `main`.
- Local verification must be fresh for the exact state being published.
- Typed publication requires the exact active `project_resume` context and Admin authority.
- GitHub is the publication/review/final-CI gate, not the primary development/test environment.
- macOS TCC, SIP, FileVault/login, Keychain authentication, and sudo/root boundaries remain authoritative.
- ChatGPT product-surface/tool-routing restrictions are not bypassed by keyword changes or local fallbacks.
- `origin/feat/computer-use-bridge` remains intentionally preserved until separately classified.

## Blockers / uncertainties

- No blocker remains for the completed Owner Workstation + Verified Project Session slice.
- Browser Runtime versus pure Computer Use simplification remains a separate future benchmark/design decision.
- ChatGPT product-surface routing is controlled by ChatGPT; the local MCP can expose recovery guidance but cannot force a surface that does not support developer MCPs to expose them.
- `origin/feat/computer-use-bridge` still contains separately retained unmerged work and requires its own classification before any deletion.
