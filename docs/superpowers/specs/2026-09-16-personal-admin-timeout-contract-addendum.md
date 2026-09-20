# Personal Admin ergonomics and Computer Use timeout contract — design addendum

**Status:** Design only; implementation and native verification blocked. Not a claim of a fix.
**Date:** 2026-09-16
**Base:** `main@1080cbe93a10418d054a476e4a7f89dd6240d243`
**Worktree:** `fix/personal-admin-timeouts-20260916`

## Deliberate security/ergonomics decision

The owner's wish to avoid manually entering Admin and seconds applies only when `personalAdmin.enabled === true`, an existing explicit opt-in for a trusted private workstation. `computer_*` input schemas should make `authorityLeaseId` optional only in that mode. If omitted, resolve a live Admin authority or mint a memory-only Admin lease using the existing one-hour maximum and existing audit path. If an explicit lease ID is provided, resolve *that exact lease*; invalid, expired, Project, or User leases must fail rather than silently falling back to Admin. If personal mode is disabled, preserve the required lease and rejection behavior. Health remains lease-free independently.

An omitted `session_authority_start.profile` may default to Admin only in opted-in personal mode. Any **present** invalid profile value (including `"project "`, empty string, `null`, unknown text or unexpected type) must be rejected; do not rewrite it to Admin. Project requests still require valid project roots; Admin scope comes from trusted authority code, not user roots. Keep one-hour expiry, terminal `--enable-terminal` gate, allowed commands, TCC permissions, physical user takeover, audit redaction, and platform safety enforcement. Do not persist leases, disable authorization globally, or install/restart the live helper as part of this fix.

## Deliberate timeout decision

The public verification and focus contract is a finite **50–60,000 ms** per explicit operation, inclusive; reject 49 and 60,001 rather than silently coercing out-of-range values. Fix all layers together: public MCP schema, TypeScript direct/batched validation, Computer JavaScript RPC schema, Swift action/verification parsing, and native supervisor. A supervisor's default request timeout can remain short for ordinary requests, but must not clamp a validated explicit verification deadline to its default 10 seconds. The native request's own timeout must leave appropriate bounded transport margin for a legitimate 60-second wait, without making all requests unbounded. Preserve outer action-program deadlines and cancellation; an explicit 60-second per-action timeout does not override a shorter authorized program deadline. Do not treat a longer timeout as evidence that S1's missing navigation is fixed.

## Test-first acceptance

Six test-only files were changed on this branch before any production implementation. The five TypeScript suites currently give **six expected failing tests / 86 passing**, exercising malformed explicit profile; opted-in lease-free Computer calls and explicit weak-lease rejection; disabled-mode rejection; direct and batched 60-second values; JavaScript RPC 60-second values; and supervisor long-request handling. A Swift verification parser regression was also added but its targeted execution was platform-blocked. After permitted code implementation, require GREEN on the focused suite and Swift regression, boundary rejection tests, `npm run check`, native tests/build, audit, Git whitespace and exact-head repository checks before claiming completion. No GREEN or performance benefit has been established yet.

## Release and measurement boundary

This branch is separate from `main`; do not push, merge, deploy or replace the installed helper without distinct authorization and exact-head verification. The existing computer-flow performance S1 result is **7/10**, under its **9/10** gate, and remains unresolved independently of this timeout/authority correction. Speed improvements from fewer agent/MCP calls must be measured rather than assumed.
