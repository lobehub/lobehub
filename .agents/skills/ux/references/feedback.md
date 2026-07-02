# Feedback — loading & system response

How the product **answers back** while and after the user acts — loading visuals and
proactive guardrails.

Part of the **ux** skill — see [`../SKILL.md`](../SKILL.md). Each checklist item is
tagged with the design value(s) it serves.

## 4.1 Loading visuals・Natural

**Never use antd `Spin`** — it doesn't match the product's loading visual. Use a project
loader:

| Need                        | Component                                                                     |
| --------------------------- | ----------------------------------------------------------------------------- |
| Default loading (in-flight) | `NeuralNetworkLoading` from `@/components/NeuralNetworkLoading` (`size` prop) |
| Inline dots                 | `DotsLoading` / `BubblesLoading` from `@/components`                          |
| Branded full-page           | `Loading` from `@/components/Loading/BrandTextLoading`                        |
| List / card placeholder     | a skeleton (e.g. `SkeletonList`)                                              |

When in doubt, reach for `NeuralNetworkLoading` — the default in-flight indicator (e.g.
modal "in progress" states). Minimise layout shift (CLS): the strongest loading state
changes as little of the final layout as possible. When a surface already knows its shape
(card, row, list item), keep the layout elements — container, border, radius, padding,
icon — and replace only the text/data with a skeleton sized like the text it stands in
for. A generic full-block / full-card skeleton (or a centred spinner the real content
later pushes aside) is heavier and shifts the layout; an in-place text→skeleton swap is
optimal.

**Checklist**

- [ ] No antd `Spin`; use `NeuralNetworkLoading` / project loaders. _(Natural)_
- [ ] Skeleton reuses the loaded component's chrome — content swap, not relayout. _(Certainty・Natural)_
- [ ] Skeleton lines sized like the text they replace (height ≈ real). _(Certainty)_
- [ ] Known-shape surface not downgraded to a bare block / spinner. _(Natural)_

## 4.2 Loading must be able to fail — timeout → error + retry・Certainty・Meaningful

A loading state that can only ever resolve to _success_ is a bug. Any async fetch can hang,
time out, or error, so every loading state needs a **terminal failure path**: after a
bounded wait (or on an error) the spinner / skeleton must give way to an explicit **failed**
state that says it didn't load and offers a **Reload / Retry** button. An indefinite spinner
is indistinguishable from a dead one — the user is stuck with no recourse but to reload the
whole app, and can't even tell whether anything is still happening. A failed-with-retry
state hands control back and restores certainty. Retry re-runs the _same_ fetch (SWR
`mutate` / query refetch), shows loading again while it re-runs, and stays available if it
fails again; keep any already-loaded context rather than blowing the surface away.

> **We under-build this today** — most surfaces only draw loading + success and let a slow
> or failed request spin forever. Treat the failure path as required, not optional: it's a
> large part of what makes the experience feel trustworthy.

A common shape of this bug: the surface gates its "ready" render on an **init flag that is
set only on a successful fetch** (`if (!isInit) return <Skeleton/>`). On error the flag
never flips, so the skeleton is **permanent** — an infinite spinner wearing a skeleton's
clothes. The error path must drive the flag / a separate `error` state, not be forgotten.

> ✅ A panel whose data request errors or exceeds its timeout shows "加载失败" with a
> **Reload** button that refetches. ❌ A `NeuralNetworkLoading` that spins indefinitely when
> the request hangs. ❌ `isInit` set only in the success handler, so a failed fetch leaves
> the skeleton up forever. _(pairs with Read §1.1 error state, §4.1 loading visuals.)_

**Checklist**

- [ ] Every loading state has a terminal failure path — on error or after a bounded timeout, not an infinite spinner. _(Certainty)_
- [ ] An init/ready flag isn't gated on success only — the error path resolves the loading state too, no permanent skeleton. _(Certainty)_
- [ ] The failed state names the failure and offers a **Reload / Retry** action. _(Meaningful)_
- [ ] Retry re-runs the same fetch, shows loading while re-running, and stays available on repeat failure. _(Certainty)_
- [ ] Already-loaded context is preserved on failure — don't wipe the surface. _(Meaningful)_

## 4.3 Capability-gated features・Certainty・Meaningful

A feature can be fully built and still produce a broken result when the selected model —
or its still-loading config — **can't deliver the capability the feature depends on**
(e.g. an agentic run on a model without tool calling). This is usually the user's
configuration choice, not a defect; but if the product stays silent the user reads it as
broken. Owe a **proactive, non-blocking reminder** — a guardrail, not a gate: a soft
inline warning at the point of action, never a hard block or a modal that stops the user.
Stay reactive — the reminder clears the moment the user switches to a capable model
(derive from live state, not a one-shot check). Don't warn while config is still loading
(an unresolved capability looks "unsupported" — a false alarm); warn only on a _resolved_
unsupported state. Scope to the mode that needs it — one reminder per root cause — and
state both the problem and the remedy.

**Checklist**

- [ ] Missing capability shows a soft inline warning, never a hard block. _(Meaningful)_
- [ ] Reminder is reactive — clears when a capable model is selected. _(Natural)_
- [ ] No warning while config is still loading; only on resolved-unsupported. _(Certainty)_
- [ ] Scoped to the dependent mode; one reminder per root cause. _(Natural・Certainty)_
- [ ] Copy states the problem and the remedy. _(Meaningful)_
