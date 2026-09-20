# Identity-bound native Browser click — disposable research (2026-09-17)

**Result: not production-safe; do not ship.** Binding Playwright's native physical `ElementHandle.click` to the approved DOM node prevented a proven same-name replacement wrong click but did not enforce strict semantic uniqueness through the entire asynchronous action. No Browser/Computer production code or live Chrome/MCP was changed.

## Scope and mechanism

- The previous authorization-gate research (`BROWSER_DECISION_GATE_SPIKE_2026-09-17.md`) proved that a node-identity precheck followed by a fresh `locator.click` can click a same-named replacement. This follow-up is a **throwaway action-layer experiment**, not a model, real user-intent authorization engine or production integration.
- On the owner-controlled headless Chromium page, a temporary JavaScript adapter first checked the real `PlaywrightBrowserBackend.targetCount`, allowed a bounded wait for a late target, captured the one matching node with `locator.elementHandle`, and then called the existing `BrowserService.click` through a one-operation backend proxy. The proxy reran the current target count, confirmed exact original DOM identity, checked page URL and a main-frame navigation epoch, then used **`captured.click({timeout})`**, i.e. Playwright's native click action with its normal visibility/stability/enablement/hit-testing behavior. No `force`, synthetic dispatch or manually cached mouse coordinates were used.
- Existing `BrowserService` `assertUniqueTarget` executed in this prototype. The separately tested **unmodified BrowserService** credential `fill` guard refused a password field. That is *not* a claim that the adapter safely implements bound `fill`/`selectOption`: it implements **click only**. The adapter's initial absent/hidden branch yielded a raw Playwright wait timeout instead of BrowserService's normal typed target-not-found error, another integration mismatch. An exact authenticated user-intent/target authorization source remains unsolved.
- Playwright version 1.63.0. `ElementHandle` is a legacy API direction; this experiment is neither an endorsement nor an API migration design.

## Test evidence (real owner-controlled Chromium, no user websites)

Test-first placeholder initially exited 1 (`IDENTITY_BOUND_NOT_IMPLEMENTED`). After implementing the disposable adapter, a full run exited 0 with **15/15 assertions**; the full run was repeated and again exited 0 with 15/15. The set intentionally contains a `PASS ... COUNTEREXAMPLE` test that asserts an unsafe behavior is reproducible; `15/15` is **not** a 15/15 safety result.

| Scenario | Existing locator click | Identity-bound adapter |
| --- | --- | --- |
| Unique button | Trusted native click | Trusted native click; expected original |
| Same-name replacement after last identity precheck | **Wrong replacement clicked:** original 0, decoy 1 | Refused; original 0, decoy 0 |
| Same-name replacement while initially disabled click is waiting | **Wrong replacement clicked:** original 0, decoy 1 | Refused (`BROWSER_UNAVAILABLE` classification); both 0 |
| Duplicate initially / before backend identity check | Not measured side by side | Refused ambiguous, no click |
| Original detached / iframe detached / main-frame navigation | Not fully compared | Refused in tested cases |
| Hidden / disabled / covered | Not separately benchmarked | Refused; timeout or not-found; no click |
| Moving target; delayed 160 ms target; iframe sibling of main target | Not compared | Original clicked normally or late target clicked; main-frame target isolated from iframe; detached child handle refused |
| Password-field fill | Existing service refused `BROWSER_CREDENTIAL_ENTRY_REFUSED` | Adapter does not implement fill |
| **Second matching button added after final count, before click** | Not probed in this seam | **Still clicked original** while two matches existed: original 1, decoy 0, `ok:true` |
| **Second matching button added while disabled original click waited** | Not probed | **Still clicked original** after it became enabled, with two matches; action returned success |

A node-bound click prevents the *replacement* race but cannot, solely by doing a final remote count, guarantee strict uniqueness at the actual click moment. Playwright's actionability protects the physical click but does not automatically recheck the original semantic match count for a bound handle throughout waiting. A remote `count → handle.click` sequence is not atomic. No safe production workaround for this was proved; this experiment must not be merged into service code.

## Timings

Two independent, alternating headless Chromium runs each measured 32 baseline clicks and 32 bound clicks, from action call through completion; successful target only, startup excluded. The adapter performs extra count/identity work. Timings include BrowserService and Playwright, not a model, hosted MCP or total task.

| Run | Baseline median / p95 | Bound median / p95 | Bound minus baseline median |
| --- | ---: | ---: | ---: |
| 1 (32 + 32) | 189.69 / 210.18 ms | 202.50 / 234.44 ms | +12.81 ms |
| 2 (32 + 32) | 201.86 / 214.13 ms | 206.61 / 232.42 ms | +4.75 ms |

No local speed improvement demonstrated, and these 32-sample p95 values are not general performance guarantees. The earlier gate's 114-ms experiment used different configuration/run and must not be compared directly. No 150x, RLCD decision, or end-to-end speedup was measured.

## Next exact step

Do not ship either raw RLCD decisions, the earlier identity-precheck-and-locator gate, or this identity-bound-click prototype. Before a production design, explicitly decide the safety invariant: node identity and *current semantic uniqueness*, including DOM mutation while actionability waits. Consider browser-process-coupled enforcement or an abortable mutation-aware action mechanism only if it can be independently shown to prevent event dispatch to unauthorized targets and preserve trusted events, credential protection, navigation, iframe isolation and normal actionability; a check from Node followed by input cannot be assumed atomic. Also solve authority provenance for translating a user's high-level instruction into an exact allowed action/target, then test heterogeneous real owned sites and measure actual model/MCP/task latency. The previously hosted-blocked full `npm run check` was neither rerun nor bypassed in this research; publishing needs separate user approval and exact verified gate.
