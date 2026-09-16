# Computer Use Flow Benchmark

This runbook operates the Plan A benchmark/baseline layer. It does not authorize deployment, helper replacement, tunnel restart, normal Chrome restart, or any production-side shortcut.

## Required collection

Runtime Mode is mandatory across all six scenarios for the Plan A baseline. Use exactly one unrecorded warm-up followed by ten recorded runs for each scenario. Runtime records come from benchmark-owned direct runtime/native trace boundaries and signed fixture-owned assertions.

Agent Mode collection is mandatory for web S1-S5 because bottleneck selection depends on model/runtime behavior as well as Runtime Mode. Native Agent Mode is optional under the scenario rule. Every Agent run uses one exclusive audit window for attribution; exclusivity improves attribution only and does not turn a best-effort audit into a lossless source.

The current global audit is best-effort and lossy. Observed audit presence can provide bounded positive categorical evidence. Missing audit records do not prove absence, exact counts, or completeness. Exact Agent tool/count metrics, turn/round-trip counts, end-to-end timing, and direct verification metrics remain unavailable unless a trustworthy correlation/start/result or lossless trusted source exists.

Accordingly, `browser_runtime_absent`, shell/process/filesystem absence, and `computer_run_js` absence never pass merely because matching audit records are missing. Any observed forbidden Browser Runtime, `computer_run_js`, shell, process, filesystem, or other disallowed measured action still invalidates the run. Current Agent scenario gates may legitimately remain `incomplete`; unavailable evidence is never converted to zero or pass. Agent full `57/60` is never claimed unless all six scenarios actually have every required assertion authoritative.

Scenario 1 uses the strict read-only Chrome-process oracle with the `pre ⊆ post` preservation rule. Process identifiers remain in memory and are never persisted. Scenario 6 completion comes from the independent fixture-owned snapshot and never from AX/runtime self-certification.

## Collector key and signed artifacts

Set `CHATGPT_SYSTEM_COMPUTER_FLOW_COLLECTOR_KEY` to at least 32 UTF-8 bytes before collection, evaluation, or comparison. The key is never persisted. `evaluate` and `compare` reject a missing/wrong collector key and tampered signatures before gate or comparison arithmetic.

Raw result artifacts are local/ignored under `benchmarks/computer-use-flow-performance/results/`. PROJECT_STATE and continuity store only privacy-safe summaries or digests. Do not copy screenshot content, OCR/AX/page text, typed values, coordinates, raw errors, user content, credentials, secrets, leases, native pointers, document text, or model prose into result metadata.

Artifacts use deterministic names:

```text
<mode>-<scenario-id>-<build-id>.json
```

## Commands

List scenarios:

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts list
```

Runtime Mode, one scenario:

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts runtime-batch \
  --scenario open-focus-verify \
  --runs 10 \
  --warmups 1 \
  --output benchmarks/computer-use-flow-performance/results
```

Agent Mode, one web scenario:

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts agent-batch \
  --scenario batched-multi-control-form \
  --runs 10 \
  --warmups 1 \
  --audit-file ~/.chatgpt-system/audit.jsonl \
  --output benchmarks/computer-use-flow-performance/results
```

For Agent Mode the CLI arms one controlled fixture at a time. For web scenarios it prints only scenario ID, goal, fixture URL, and run ordinal, then waits for the operator to complete that measured run. Optional native Agent Mode launches only the owned deterministic native fixture and does not fabricate web fields.

Evaluate a signed batch:

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts evaluate \
  benchmarks/computer-use-flow-performance/results/runtime-open-focus-verify-<build-id>.json
```

Comparison objective selection is explicit and must be decided before loading metrics. There is no `auto`, `best`, omitted-objective, or unsigned-evaluation path.

Flow boundary:

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts compare \
  --objective flow_boundary \
  --scenario open-focus-verify \
  BASELINE.json CANDIDATE.json
```

Flow latency:

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts compare \
  --objective flow_latency \
  --scenario batched-multi-control-form \
  BASELINE.json CANDIDATE.json
```

Runtime latency selectors are exactly `runtime_total`, `local_action_program`, or `operation:<closed-operation>`. The operation form maps to sum-per-run aggregation.

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts compare \
  --objective runtime_latency \
  --scenario weak-ax-ocr-visual-point \
  --selector operation:click \
  BASELINE.json CANDIDATE.json
```

Reliability comparisons require the target failure category plus matched signed non-target regression-guard batches. Each side must contain exactly ten signed runs for every non-target scenario, with identical scenario sets and no duplicates.

```bash
npx tsx benchmarks/computer-use-flow-performance/cli.ts compare \
  --objective reliability_defect \
  --scenario stale-dynamic-target-recovery \
  --failure-category stale \
  --baseline-guard BASELINE-open-focus.json \
  --baseline-guard BASELINE-form.json \
  --baseline-guard BASELINE-scroll.json \
  --baseline-guard BASELINE-weak-ax.json \
  --baseline-guard BASELINE-native.json \
  --candidate-guard CANDIDATE-open-focus.json \
  --candidate-guard CANDIDATE-form.json \
  --candidate-guard CANDIDATE-scroll.json \
  --candidate-guard CANDIDATE-weak-ax.json \
  --candidate-guard CANDIDATE-native.json \
  BASELINE-TARGET.json CANDIDATE-TARGET.json
```

## Safety and operational boundaries

Measured Agent Mode forbids Browser Runtime, `computer_run_js`, shell/process/filesystem shortcuts, credentials, CAPTCHA handling, destructive mutations, payments, message sending, permission changes, and unauthorized application takeover. Preserve existing Computer Runtime focus, stale-target, takeover, TCC, verification, emergency-stop, and held-input cleanup boundaries.

No installed-helper replacement or tunnel restart belongs to Plan A baseline execution. If later acceptance requires deployment, helper replacement, or controlled supervisor/tunnel lifecycle work, obtain separate authorization first.
