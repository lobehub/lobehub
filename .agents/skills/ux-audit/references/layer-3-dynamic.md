# Layer 3 — Dynamic audit (automated user journey + instrumentation)

L1 reads code, L2 looks at a render; **L3 drives the product like a user and measures it.**
It's the only layer that reaches states that exist only at runtime (in-progress, forced
error / empty), that verifies a **journey** stitches step-to-step, and that produces
**numbers** — CLS, LCP, INP, long-tasks — which no screenshot or code read can give.

This layer runs on the **agent-testing** framework. Read that skill first; L3 assumes its
**Step 0 (env + auth)** is already green. Everything below is CDP-based, so it also works
headless in cloud under `xvfb-run`.

Part of the **ux-audit** skill — see [`../SKILL.md`](../SKILL.md).

## The driver: agent-browser over CDP

Connect to the running app (Electron or web) and use:

| Command                                    | Use in an audit                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `agent-browser --cdp 9222 snapshot -i`     | accessibility/DOM tree + interactive elements (find controls, assert presence) |
| `agent-browser --cdp 9222 screenshot`      | render evidence at each step (feeds L2 checks)                                 |
| `agent-browser --cdp 9222 eval "<js>"`     | **instrument** — inject web-vitals, read state, force conditions               |
| `type` / `click` (see agent-testing `ui/`) | drive the journey                                                              |
| `scripts/record-gif.sh`                    | time-based evidence (streaming, a layout jump)                                 |

> **Constraint:** resizing the Electron window triggers a full SPA reload — do **responsive
> / multi-viewport** sweeps against **web Chrome over CDP**, not by resizing Electron.

## Journey template

Define the surface's **User Journey** as ordered steps, then walk it, capturing evidence at
each and asserting forward momentum. Example (home → task):

1. Land on the surface → `snapshot` + `screenshot`; assert the primary control is focusable.
2. Perform the core action (type + send) → capture the **in-progress** state (is it shown?
   locked?), then the **done** state; assert it **leads forward** (does step 2 surface the
   entry to step 3?). _(ux Act §3.1)_
3. Force the **error** path (below) → assert a failure + **retry** appears, input preserved.
   _(ux §4.2 / §2.1)_
4. Force the **empty** path → assert a purpose-built empty state, not a blank / stuck one.

Record per step: `snapshot`, `screenshot`, and pass/fail against the expected state. A step
with no forward path, a dead spinner, or a wiped input is a finding.

## State-forcing cookbook

The states L1/L2 can't reach, made reachable:

- **Error / offline** — CDP `Network.emulateNetworkConditions {offline:true}` (or block the
  specific request route), then trigger the fetch; watch for the failure+retry UI. This is
  how you catch the "permanent skeleton" (ux §4.2) live.
- **Slow / hold-loading** — CDP throttle (slow 3G) to freeze the skeleton long enough to
  screenshot and judge (L2) — and to see if it ever times out.
- **Empty** — a fresh / empty account, or clear the relevant store/table, to render the
  first-run empty state.
- **Capability-gated** — select a model lacking the capability, assert the soft warning
  appears (ux §4.2 capability) and clears on switching back.

## Performance & CLS instrumentation

Screenshots can't quantify jank; inject observers via `eval`. Inject **before** navigating /
triggering, then read the accumulated value after the surface settles.

**Cumulative Layout Shift** (the one L1/L2 can't measure):

```js
// 1) inject before load/trigger:  agent-browser --cdp 9222 eval "<this>"
window.__cls = 0;
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
}).observe({ type: 'layout-shift', buffered: true });
// 2) after the surface settles:   agent-browser --cdp 9222 eval "window.__cls"
```

Same shape for the rest: `observe({ type: 'largest-contentful-paint' })` → LCP;
`observe({ type: 'longtask' })` → main-thread blocking; INP via the `web-vitals` lib if
present. Read them after the loading→content swap, which is exactly when skeleton-height
mismatches (ux Feedback §4.1) show up.

**Thresholds** (Core Web Vitals): CLS ≤ 0.1 good · ≤ 0.25 needs-work · else poor. LCP ≤
2.5s good. INP ≤ 200ms good. Report the number **and** the verdict, and point at the block
that shifted.

## Honest limits

- Needs a running env + green auth (agent-testing Step 0); slower and more **flaky** than
  L1/L2 — re-run a failed step before trusting it.
- Not every state is easy to force (some error paths need route-level mocking / fixtures).
- Screenshots captured here still need an L2 vision pass (Read the image before citing).
- Keep L3 for what only it can do — journeys, forced states, and metrics. Don't re-derive
  L1/L2 findings here.

## Output contribution

Per journey: step-by-step pass/fail with `snapshot`/`screenshot` evidence; forced-state
findings (error/empty/loading) that L1 only inferred, now **confirmed live**; and a perf
table (CLS / LCP / INP / long-task with verdicts). Feed all into the shared report shape.
