# Browser task phase timing — disposable isolated measurement (2026-09-18)

**Research result: measured the local BrowserService/Playwright workflow, not ChatGPT's model or real hosted MCP transport. No production change or task speedup is claimed.** The intent is to select a measurable optimization target rather than alter actionability/security based on intuition.

## Method and limits

- Owned headless Playwright Chromium, ephemeral `127.0.0.1` HTTP fixture server, existing unmodified `BrowserService` and `PlaywrightBrowserBackend`. No external pages, normal Chrome profile, Computer Runtime, live MCP or production source involved. A disposable Proxy timed public backend calls but preserved their implementation; `performance.now()` measured service-stage elapsed time. Timing traces recorded only synthetic operation names and durations, not webpage text or user input. Both independent program invocations closed their browser and server in `finally`.
- Twelve distinct synthetic workflows: approve, retry, dialog with two clicks, search with fill, region select, compose with fill/select, two fields, two selects, late-appearing button (140 ms), delayed result text (170 ms), input-enables-button, and two-step click with delayed second control (135 ms). Each one used a deliberately generated localhost form, a trusted predeclared action plan, a real semantic BrowserService operation sequence and an independent final DOM check (expected click indices, trusted browser events, completion exactly once, visible result).
- Each run: one unmeasured warmup; twelve workflows times four repetitions in alternating forward/reverse order, **48 task trials**. Ran the same experiment twice independently, **96/96 successful trials** and no observed wrong-click or incorrect result in these owned fixtures. Every run also separately confirmed duplicated target refusal `BROWSER_TARGET_AMBIGUOUS` and password-shaped fill refusal `BROWSER_CREDENTIAL_ENTRY_REFUSED`; these checks are not a full security qualification.
- Timer begins before `BrowserService.navigate` to owned localhost URL, includes navigation, one redacted `BrowserService.snapshot`, a **scripted** map of known steps (not model reasoning), BrowserService fill/select/click/wait actions, and final direct Playwright DOM verification. Browser startup, localhost server startup and warmup excluded. Summed non-overlapping stage timings were checked against task wall time with a less-than-4-ms threshold on every sample. Backend method timings are **nested within stage times**, not to be added to them. A temporary script and two JSON outputs were removed after recording the summarized evidence in this document.
- No hosted ChatGPT model inference or internal decision breakdown was available to this standalone runner; **actual model latency NOT MEASURED**. It also did not send messages through the hosted MCP or real remote connection; **actual hosted MCP RTT NOT MEASURED**. Scripted plan time around 0.01 ms is emphatically *not* a model inference benchmark. This local end-to-end workflow is **not** an end-to-end ChatGPT user-task benchmark. Twelve generated templates are not twelve independent real sites; results do not represent arbitrary websites or Computer Use.

## Two independent runs

| Metric | Run 1 | Run 2 |
| --- | ---: | ---: |
| Controlled tasks completed | 48/48 | 48/48 |
| Task duration median | 312.79 ms | 314.40 ms |
| Task duration p95 | 624.55 ms | 616.80 ms |
| Total timed workflow | 17,702.26 ms | 17,765.53 ms |
| Navigation share | 4.11% | 4.17% |
| Snapshot share | 6.89% | 7.78% |
| Actions and result wait share | 87.92% | 86.95% |
| Independent final verification | 1.08% | 1.10% |

Across 96 samples, the **summed wall-time distribution** is approximately: navigation **4.14%**, one observation **7.33%**, scripted planning approximately **0%**, BrowserService actions including result wait **87.43%**, independent final check **1.09%**. These shares are sums of wall duration across workflow samples, **not** averages of per-task percentages, and do not include unmeasured model/hosted MCP time. The large share of browser actions is partly because this fixture's plan is already known: do not extrapolate its shares to a model-in-the-loop agent.

### Backend detail, both runs combined

| Instrumented Playwright backend call | Invocation count | Summed wall time | Contribution to measured task time |
| --- | ---: | ---: | ---: |
| Native `click` (including actionability/transport) | 112 | 17,044.58 ms | about 48.1% |
| `waitForText` (includes page readiness delay) | 96 | 8,947.20 ms | about 25.2% |
| **Together** | 208 | 25,991.78 ms | **73.28%** |
| `targetCount` | 260 | approximately 582.74 ms | about 1.6% |

Native backend click medians: **168.40 ms** and **165.19 ms** in runs 1 and 2. BrowserService click medians (including its uniqueness checks) **178.38 ms** and **178.30 ms**; service wait-for-text medians **78.62 ms** and **78.79 ms**. `fill` service medians 12.28/13.24 ms, `select` 7.29/6.81 ms. A deliberately late button increases `targetCount` and click duration; a deliberately delayed result makes wait longer. Click time contains Playwright visibility/stability/enablement/hit-testing; do **not** switch to `force`, synthetic events or cached coordinates to eliminate it. Wait time includes actual application readiness and Playwright polling; do not count it entirely as avoidable waste.

## Interpretation and next exact experiment

For these preplanned local flows, one snapshot and basic service metadata checks are not the main measured cost. Browser action + readiness wait dominate. However, the model and hosted MCP layers—potentially important in Jev-like systems—are **absent**, so this data cannot answer which component dominates a real ChatGPT end-to-end task, nor demonstrate any Jev/150x or local optimization speedup. Prior aggressive-click, authorization and identity-bound prototypes are unsafe in a DOM mutation race; none should be deployed on the strength of these times.

**Next:** request separate approval for narrowly scoped observation-only runtime/MCP boundary timing that records only monotonically timed durations, action class and aggregate counts (no prompts, page content, sensitive values, leases, URLs or account data). Compare actual model-to-tool roundtrip if the hosted platform exposes such measurements; otherwise label the unobservable part rather than estimate it. Independently design a safe browser-native timing experiment to separate *necessary page wait* from *framework scheduling*, preserving the existing actionability/uniqueness/credential contract. Only pursue a product change if a baseline, correctness and end-to-end speedup can be measured. The earlier hosted full `npm run check` platform block was not rerun or bypassed. No push, PR, merge, deployment or live update was made.
