# Computer Use Agent Reliability v2 Design

**Status:** Approved for implementation
**Date:** 2026-09-14
**Branch:** `feat/computer-use-perception-reliability`
**Base implementation:** `5cb22d7c62cc8e2cbffc2bc5f855abcd19737c0a`
**Parent design:** `docs/superpowers/specs/2026-09-14-computer-use-perception-reliability-design.md`

## 1. Goal

Make explicit Computer Use reliable enough that GPT-5.6 Sol can complete real Google Chrome / ChatGPT Web workflows deterministically, then reuse the same primitives for other macOS applications. The local runtime remains deterministic infrastructure; GPT remains the only planner.

The reliability loop becomes:

```text
observe structured interaction context
-> choose semantic target / scroll container
-> revalidate app + window + target context
-> perform bounded physical action
-> collect action-aware verification evidence
-> fresh observe after uncertainty
-> bounded recovery
-> one screenshot-bound visual point only after semantic options are exhausted
```

## 2. Non-goals and invariants

- Do not add a local LLM or hidden autonomous planner.
- Do not replace explicit Computer Use with Browser Runtime / Playwright.
- Do not restart an already-running normal Chrome process.
- Do not weaken TCC, focus checks, takeover monitoring, CAPTCHA/anti-bot boundaries, or physical input safety.
- Do not introduce unbounded scroll, OCR, screenshot, action, or retry loops.
- Do not repeat blind raw coordinates against unchanged UI state.
- Preserve existing normal Chrome profile/session behavior.
- Preserve unrelated working-tree changes in `scripts/setup-daily-driver.mjs` and `tests/setup-daily-driver.test.ts` exactly.

## 3. Root causes found during live acceptance

### 3.1 Flat observation loses interaction structure

`ComputerElementView` currently exposes role/text/state/bounds but no parent/depth relationship. GPT cannot reliably distinguish a modal's scroll region from a background page or determine which container owns an off-screen target.

### 3.2 Scroll capability is executable but poorly observable

`computer_scroll` can emit physical scroll events, but observation does not expose bounded scrollability metadata. When Chrome renderer AX is weak, GPT sees OCR labels but not a deterministic scroll context, causing unnecessary point attempts.

### 3.3 Pointer and scroll actions lack keyboard-equivalent focus guarding

Keyboard actions verify the expected frontmost app immediately before key emission. Semantic pointer/scroll actions resolve against an observation, then reduce to a point; focus/window context is not rechecked at every physical mutation boundary.

### 3.4 Generic verification can misclassify successful actions

A real `Plugins` click succeeded during acceptance, but AX text verification timed out. A posted event plus changed region should not be reported as an ordinary failure merely because one verification modality lacks evidence.

### 3.5 Screenshot coordinate contract is implicit

The screenshot tool exposes pixels but not enough screen-space capture metadata for robust normalized point mapping across Retina scaling / multi-display / window movement.

### 3.6 Recovery errors do not provide enough bounded next-step evidence

`TARGET_NOT_FOUND`, `TARGET_AMBIGUOUS`, and `NEEDS_REPLAN` identify failure class but provide little deterministic guidance such as candidate containers or whether a relevant scroll region can move further.

## 4. Observation hierarchy and interaction metadata

Extend each observed AX element with bounded structural metadata:

```ts
type ComputerElement = {
  index: number;
  parentIndex: number | null;
  depth: number;
  role: string;
  subrole?: string;
  title?: string;
  description?: string;
  focused?: boolean;
  enabled?: boolean;
  selected?: boolean;
  bounds?: ComputerBounds;
  actions: string[];
  scroll: {
    scrollable: boolean;
    axes: ("vertical" | "horizontal")[];
  };
};
```

Rules:

- `parentIndex` and `depth` come directly from deterministic AX traversal.
- `actions` comes from `AXUIElementCopyActionNames`, bounded to a small fixed count and bounded strings.
- `scroll.scrollable` is true for deterministic AX evidence such as `AXScrollArea`, scrollbars, or supported scroll actions; it is never inferred from OCR alone.
- The model may use hierarchy to scope a target to a known container. The runtime does not invent semantic roles from OCR.

The observation remains bounded by existing element/character limits.

## 5. Scoped targeting

Add optional structural scoping to semantic targets without breaking existing targets:

```ts
type ComputerTargetScope =
  | { by: "index"; snapshotId: string; index: number }
  | { by: "role"; role: string; name?: string; exact?: boolean };

type ScopedComputerTarget = ExistingSemanticTarget & {
  within?: ComputerTargetScope;
};
```

Resolution rules:

- Scope must resolve uniquely through AX.
- Candidate AX elements are limited to descendants of the scoped container using `parentIndex` ancestry.
- OCR scoping is only allowed when the scope has safe screen bounds; OCR candidates must be geometrically contained in those bounds.
- Ambiguity remains fail-closed.
- Explicit raw points are not scope-resolved.

## 6. Guarded pointer / scroll execution

Semantic resolution must preserve context through mutation instead of immediately discarding it.

A resolved action context contains:

```text
resolved target
app identity
window identity + generation
display topology digest
semantic fingerprint
```

Before pointer movement, before mouse-down, before mouse-up, and before scroll emission:

1. takeover safety check;
2. frontmost app identity check;
3. current focused-window identity check;
4. display topology compatibility check.

If any check fails, no subsequent physical event is posted and the action returns `COMPUTER_FOCUS_FAILED`, `COMPUTER_STALE_SNAPSHOT`, or the existing takeover error as appropriate.

Explicit point actions still validate display geometry and takeover state; they cannot claim semantic target stability.

## 7. Bounded semantic scroll primitive

Keep low-level `computer_scroll` for compatibility and add a preferred deterministic primitive:

```ts
computer_scroll_until_visible({
  target,
  within,
  direction: "up" | "down" | "left" | "right",
  amount?: "small" | "page",
  maxSteps?: 1..6,
});
```

Behavior:

1. Fresh observation.
2. Resolve `within` to one safe AX container / bounds.
3. Attempt target resolution inside scope.
4. If visible, return `target_visible` without scrolling.
5. Otherwise emit one bounded scroll at the container center.
6. Verify container screen region or AX digest changed.
7. Fresh observation and repeat, up to `maxSteps`.
8. If the same digest/region repeats or no movement occurs, stop immediately with `boundary_reached` / `COMPUTER_NEEDS_REPLAN`.
9. Never continue indefinitely and never switch to raw coordinates automatically.

For weak Chrome AX where the web modal has no AX container, GPT may still use low-level `computer_scroll` at one fresh screenshot-selected point; that visual-point attempt remains one-shot and must be followed by fresh observation.

## 8. Action-aware verification result

Physical mutation results become explicit about confidence:

```ts
type ComputerActionResult = {
  state: "verified" | "completed_unverified";
  pointer?: ComputerPoint;
  changed?: boolean;
  verification?: {
    kind: "ax" | "text" | "screen-region" | "none";
    changed: boolean | null;
  };
};
```

Rules:

- No verification requested: successful physical event => `completed_unverified`.
- Requested verification passes => `verified`.
- Requested verification fails after a semantic action: return the existing timeout/replan error according to policy.
- Composite callers may explicitly accept `completed_unverified`, then perform a fresh observe instead of incorrectly treating the event as definitely failed.
- No false `verified` state may be produced from event posting alone.

## 9. Screenshot coordinate contract

Extend screenshot metadata:

```ts
{
  width: number;
  height: number;
  captureKind: "display";
  screenBounds: { x; y; width; height };
  scaleX: number;
  scaleY: number;
}
```

The native screenshot used by MCP is the focused display when a focused display is deterministically available, otherwise the existing safe display fallback. `screenBounds` refers to macOS screen coordinates and the scale values map screenshot pixels to screen coordinates.

Add screenshot-bound target form:

```ts
{ by: "screenshotPoint"; screenshotId: string; x: number; y: number }
```

where `x` and `y` are normalized `0...1`. A screenshot-point target is accepted only while its capture metadata remains compatible with current display topology / focused window generation. Otherwise it fails stale instead of reusing an old coordinate.

If this target cannot be implemented without persistent screenshot state in this slice, the public metadata contract is still mandatory and raw point use remains one-shot. No hidden screenshot persistence is introduced.

## 10. Bounded recovery evidence

Do not expose sensitive content through audit logs. Tool-call errors may return bounded non-sensitive structured details useful for replanning:

```text
candidateCount
scopeResolved
activeScrollContainerCount
recommendedRecovery: observe | scope-target | scroll | screenshot | none
```

No OCR/page text is copied into audit metadata. Existing public stable error codes remain unchanged.

## 11. Agent-facing decision policy

`computer_observe` and scroll/action tool descriptions teach this deterministic ladder:

```text
1. Observe.
2. Strong AX -> semantic AX target.
3. Off-screen target + known scroll container -> scroll_until_visible.
4. Weak AX -> returned OCR candidates.
5. Ambiguous semantic/OCR target -> scope by container.
6. Exhausted semantic perception -> fresh screenshot.
7. At most one screenshot/raw-point attempt against that fresh state.
8. Fresh observe after completed_unverified or uncertain mutation.
9. Never repeat unchanged point/scroll attempts.
```

## 12. Performance

Targets are product targets, not brittle CI timeouts:

```text
strong AX observe                    no OCR
pointer/scroll focus revalidation    < 50 ms typical
one semantic scroll step             < 1 s typical including fresh observe
scroll_until_visible                 <= 6 physical scroll events
blind repeated raw points            0
unchanged-state scroll loops         0
explicit CU browser.* calls          0
```

## 13. Testing

Native tests must prove:

- parent/depth traversal is deterministic;
- supported actions and scroll metadata are bounded;
- scoped target resolution includes descendants and rejects background siblings;
- OCR scope containment works and ambiguity remains fail-closed;
- pointer click and scroll refuse mutation after app/window focus changes;
- takeover remains authoritative;
- scroll-until-visible stops when target appears;
- scroll-until-visible stops at unchanged boundary and respects maxSteps;
- action result states never claim `verified` without verification;
- screenshot screen bounds/scale mapping is correct.

TypeScript tests must prove:

- schemas/types expose new metadata without breaking old target callers;
- scoped targets are canonicalized identically in standalone and batched calls;
- scroll-until-visible input bounds are strict;
- output validation accepts required nullable/optional fields correctly;
- tool descriptions encode the intended decision ladder;
- Browser Runtime remains excluded from explicit Computer Use.

Real-Mac acceptance must prove:

1. existing Chrome process remains unchanged;
2. weak Chrome AX still produces focused-window OCR;
3. ChatGPT plugin navigation can intentionally scroll the correct visible panel or one-shot visual point without blind repeated scrolls;
4. `chatgpt-system-local` plugin detail can be reached;
5. Refresh can be attempted using `computer_*` only;
6. successful but semantically uncertain UI changes are followed by fresh observation rather than duplicate click;
7. no protocol-invalid key use, no blind repeated coordinates, no hidden Chrome restart;
8. user takeover stops physical activity immediately.

## 14. Review and publication gates

Before completion:

- focused TDD tests pass for every changed subsystem;
- `git diff --check` passes;
- `npm run check` passes on exact final HEAD;
- `npm run test:computer:macos` passes;
- `npm audit --omit=dev` reports zero vulnerabilities;
- Node and native builds/package pass;
- independent code review finds no unresolved correctness/safety findings;
- real-Mac acceptance is rerun on the exact deployed artifact;
- unrelated dirty daily-driver files remain byte-for-byte/diff-fingerprint unchanged;
- task-owned docs/continuity are updated;
- no push/PR/merge occurs without the user's separate publication authorization.

## 15. Definition of done

The slice is done when GPT can see enough deterministic structure to choose the correct scroll/target path, physical pointer/scroll actions are protected by the same focus principles as keyboard actions, uncertain successful mutations are not misrepresented, screenshot coordinates are explicit, recovery is bounded, and the real ChatGPT Web plugin workflow completes or fails with precise external/connector evidence rather than local blind guessing.
