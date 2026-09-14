# Native Project Verification Design

Date: 2026-09-15
Status: Proposed

## Problem

`project_check` is the freshness-bound source of local verification evidence used by `task_state` and the typed `git_push` publication gate. Its current detector only understands `package.json` scripts, and its only executor is the Linux Docker Project Exec sandbox.

That contract works for Node repositories but cannot verify a macOS-native SwiftPM project such as MacAgent:

- a repository with `Package.swift` and no qualifying `package.json` returns `checks=[]` and `UNAVAILABLE`;
- adding only `Package.swift` detection would not solve execution, because the current Project Exec image is Debian/Node and has neither the macOS SDK nor AppKit/SwiftUI;
- adding a fake `package.json` wrapper would distort the project to satisfy the harness rather than fix the harness;
- raw `git push` or manually importing PASS evidence would weaken the verified publication contract.

A direct live probe also showed Project Exec can independently be unavailable when Docker is not running. macOS-native verification must therefore not depend on the Docker lane.

## Goals

1. Preserve `ProjectCheckService` as the single freshness-bound verification evidence store.
2. Preserve the current Node/Docker behavior by default.
3. Detect a real SwiftPM project from `Package.swift` without accepting arbitrary verification commands from the caller.
4. Run macOS-native SwiftPM verification on the owner host only with explicit active Admin authority in addition to the Project lease.
5. Keep verification commands fixed, shell-free, path-confined, bounded, audited, and output-redacted.
6. Keep `git_push` semantics unchanged: clean non-main resumed worktree + fresh `project_check` PASS + Admin authority.
7. Make lack of host authority/runtime capability fail closed and observable.

## Non-goals

- Do not make the Linux Project Exec image emulate or cross-compile macOS AppKit/SwiftUI projects.
- Do not accept caller-supplied command strings in `project_check`.
- Do not add a generic arbitrary-command verification manifest in this slice.
- Do not create a second verification database or bypass `ProjectCheckService` freshness rules.
- Do not make host-native verification automatic merely because a repository contains `Package.swift`; execution still requires an explicit `project_check run` call carrying Admin authority.
- Do not change the hosted CI/PR/merge contract.

## Existing invariants to preserve

- `detect` derives checks from repository state, not arbitrary caller input.
- `run` only runs checks returned by detection.
- persisted evidence contains execution metadata and stdout/stderr digests/byte counts, never raw output.
- HEAD or working-tree changes make evidence `STALE`.
- `UNAVAILABLE`, `FAIL`, `NOT_RUN`, and `STALE` never count as success.
- `git_push` reads `project_check report`; it does not accept a caller-provided verification override.
- Admin host execution is not an OS sandbox.

## Chosen architecture

### 1. Two explicit verification execution lanes

Extend detected checks with an execution lane:

```text
project-sandbox
admin-host
```

`project-sandbox` is the existing Docker Project Exec path.

`admin-host` uses the existing Admin `ProcessService` semantics on the owner workstation. It is appropriate only for checks whose native platform environment is required and whose command template is defined by trusted harness code.

The execution lane is part of the detected check and new persisted evidence. For backward compatibility, persisted evidence that predates this field is interpreted as `project-sandbox`; the verification store version does not need to be invalidated merely for this additive field.

### 2. Detection precedence

Detection remains deterministic and repository-derived.

Node behavior keeps current precedence:

1. Parse `package.json` when present.
2. If a non-empty `scripts.check` exists, return that aggregate Node check only.
3. Otherwise collect existing Node `typecheck` / `type-check`, `lint`, `test`, and `build` scripts.
4. If at least one Node check is detected, return those checks unchanged.

Only when no Node check is detected, test for a regular non-symlink `Package.swift` at the repository root. If present, detect exactly:

```text
checkId: swiftpm:test
kind: test
command: swift
args: [test, --quiet]
source: Package.swift
execution: admin-host

checkId: swiftpm:build
kind: build
command: swift
args: [build]
source: Package.swift
execution: admin-host
```

This keeps existing Node repositories stable, supports pure SwiftPM repositories, and avoids combining two verification systems unexpectedly in mixed repositories that already declare an authoritative Node verification surface.

An invalid `package.json` remains a policy error. The detector must not silently skip a malformed existing Node configuration and fall through to SwiftPM.

### 3. `project_check run` becomes optionally dual-authority

`detect` and `report` remain Project-authority-only.

The `run` input gains an optional field:

```text
adminAuthorityLeaseId?: string
```

For `project-sandbox` checks, behavior is unchanged and no Admin lease is required.

For any selected `admin-host` check:

- an active Admin lease is mandatory;
- absence, expiry, or wrong profile fails with an authority error before host execution;
- no verification evidence is fabricated from an authority failure;
- the Project lease remains authoritative for repository root, HEAD, working-tree digest, and path confinement.

This makes native host verification an explicit dual-authority action rather than a silent expansion of Project authority.

### 4. Host executor boundaries

The host lane reuses the existing `ProcessService` execution policy rather than introducing shell execution.

Required boundaries:

- command and args come only from a detected check; the caller cannot override them;
- cwd is the canonical repository root observed under the Project lease, never an Admin-selected arbitrary cwd;
- `shell=false`;
- the configured terminal executable allowlist still applies (`swift` is already in the default allowlist);
- the existing sanitized child environment is used;
- existing output-byte and timeout limits apply;
- process execution is audited using the existing process audit path;
- project verification persists only output hashes and byte counts.

The host lane is intentionally not an OS sandbox. Running `swift test` or `swift build` executes repository-controlled build/test code as the logged-in user. Requiring an explicit Admin lease is therefore a security boundary, not an implementation detail.

### 5. Runtime structure

`createProjectCheckService` continues to resolve the Project lease and create the Project path policy.

For `run`, the tool registration may additionally resolve `adminAuthorityLeaseId` and create an Admin-scoped host executor adapter backed by `ProcessService`. `ProjectCheckService` receives that adapter only for the current run. `detect`/`report` and `git_push` do not require or retain an Admin executor.

Conceptually:

```text
project_check detect
  Project lease
  -> repository observation
  -> detected checks

project_check run
  Project lease
  + optional Admin lease
  -> observe exact repo state
  -> for each detected check
       project-sandbox -> ProjectExecService
       admin-host      -> Admin ProcessService adapter
  -> observe state again
  -> persist digest-only evidence

project_check report
  Project lease
  -> fresh/stale evidence view

git_push
  resumed Project lease + Admin lease
  -> project_check report
  -> require PASS
  -> typed Git push
```

### 6. Evidence and backward compatibility

New evidence records the execution lane so reports are transparent about how a check ran.

Old stored evidence without the field is treated as `project-sandbox`. `validEvidence` accepts either an absent field or one of the known lane values. No raw command output is added to the store.

Freshness behavior is unchanged:

- exact HEAD must match;
- exact working-tree digest must match;
- repository changes during a check set `stateChangedDuringRun=true` and render the check `STALE`.

### 7. Failure mapping

For `project-sandbox`, existing behavior remains unchanged.

For `admin-host`:

- missing/invalid Admin lease -> authority error, no host command run;
- `swift` absent or excluded by executable policy -> `UNAVAILABLE`;
- bounded execution infrastructure unavailable -> `UNAVAILABLE`;
- timeout -> `FAIL`;
- non-zero exit -> `FAIL`;
- repository state changes during execution -> `STALE`;
- successful zero exit with unchanged state -> `PASS`.

A Docker outage does not make an `admin-host` SwiftPM check unavailable, because that check does not use Project Exec. Conversely, adding this lane does not make Node checks silently fall back from Docker to the host.

### 8. Publish gate remains unchanged

`ProjectPublishGate` should not learn about SwiftPM, host execution, or Admin verification internals.

It continues to require:

```text
project_resume exact worktree
+ clean non-main branch
+ project_check report == PASS
+ active Admin authority for typed Git publication
```

The native verification Admin lease used during `project_check run` need not be the same lease later used for `git_push`; freshness is bound to repository state, while each privileged action independently requires current authority.

## Alternatives rejected

### Add only `Package.swift` detection and keep Docker execution

Rejected. A Linux Node image cannot correctly verify macOS SDK/AppKit/SwiftUI code. This would convert `checks=[]` into deterministic `UNAVAILABLE` or build failures without solving the product problem.

### Add a `package.json` wrapper to MacAgent

Rejected. It makes the application repository conform to a harness limitation and introduces Node as publication plumbing for a SwiftPM/macOS project.

### Let callers submit arbitrary host verification commands

Rejected. It would turn `project_check` into a second generic Admin shell and weaken the repository-derived verification contract.

### Automatically fall back any failed sandbox check to host execution

Rejected. Execution authority must be explicit per detected check; Node checks must not silently escape the sandbox.

### Create a second native-verification evidence store

Rejected. `ProjectCheckService` freshness is already the publication source of truth; a second store would create conflicting PASS semantics.

## Testing strategy

Implementation must follow RED -> GREEN.

### Detection tests

- pure SwiftPM fixture detects `swiftpm:test` and `swiftpm:build` in stable order;
- both checks are `admin-host` and use fixed command/args;
- Node aggregate `check` retains precedence over `Package.swift`;
- Node individual checks retain precedence when present;
- malformed existing `package.json` remains fail-closed;
- symlink/non-regular `Package.swift` is not accepted as trusted configuration.

### Authority/execution tests

- host check without Admin lease fails before execution;
- non-Admin secondary lease is rejected;
- valid Admin lease runs only the detected fixed host command;
- caller cannot provide command/args fields;
- host executor receives the canonical Project repository root as cwd;
- existing Node checks still use only the Project sandbox backend;
- Docker `UNAVAILABLE` does not trigger host fallback.

### Evidence/privacy tests

- host PASS evidence stores hashes/byte counts but not stdout/stderr contents;
- host FAIL and unavailable mapping are categorical;
- repository mutation during host verification produces `STALE`;
- old evidence without execution lane remains readable as sandbox evidence.

### Publication tests

- fresh host-native PASS evidence satisfies the unchanged publish gate;
- host `NOT_RUN`, `FAIL`, `UNAVAILABLE`, or `STALE` still blocks push;
- HEAD or working-tree mutation after host PASS blocks publication until rerun.

### Real-macOS acceptance

On the MacAgent SwiftPM feature branch:

1. `project_resume(MacAgent-activity-theme)` resolves the exact feature worktree.
2. `project_check detect` returns the two SwiftPM checks instead of `checks=[]`.
3. `project_check run` without Admin is denied.
4. With explicit Admin authority, `swift test --quiet` and `swift build` execute on the macOS host under the detected fixed checks.
5. `project_check report` returns fresh `PASS` for the exact HEAD + working-tree digest.
6. Safe `git_push` succeeds without raw Git publication or a package.json wrapper.
7. PR creation/review proceeds normally.

## Success criteria

The design is implemented successfully when:

1. Existing Node verification behavior and tests remain green.
2. SwiftPM repositories are detected without caller-provided commands.
3. Host-native checks cannot execute without explicit Admin authority.
4. Host-native execution is shell-free, allowlisted, Project-root-confined, bounded, and output-redacted.
5. A Docker outage cannot force SwiftPM checks into the wrong lane or cause Node checks to escape the sandbox.
6. Evidence freshness semantics and the typed `git_push` gate remain unchanged.
7. MacAgent can produce fresh local `project_check` PASS evidence on macOS and publish through the existing safe push path.
