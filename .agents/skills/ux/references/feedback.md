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

A third shape, in a **transient / auto-dismissing** surface (an upload dock, a progress toast,
a status snackbar that clears itself after N seconds): auto-dismiss is a **success** affordance,
not a universal one. When the timer also fires on the **failed** state it clears the error — and
often the failed item itself — before the user can react, so the failure is not just un-retryable
but **invisible**. Gate auto-dismiss on success only; a failed item must **persist** (stay in the
dock / keep the toast) and carry a **Retry**. Dismissing a failure should be the user's choice,
never a countdown's.

> ❌ The **Resource** upload dock auto-dismisses after 3s whenever the status isn't `uploading`
> or `pending` — so the **`error`** state falls through too: a failed upload hides the dock and
> `removeFiles` after 3s (`ResourceManager/components/UploadDock/index.tsx`), with no error kept
> and no retry anywhere. ✅ Guard the timer on `success` only; keep failed files with a per-item
> Retry.

Another shape, on the **write** side: an action that gates forward navigation sets an
`isNavigating` / `isSubmitting` flag, `await`s a write, then advances — but with **no
`finally`**. If the write rejects, the flag never resets, so the advance control (and often
Back with it) stays `disabled` **forever**, with no error and no retry — a dead end wearing a
"busy" label, and worse when that write is the one gating the whole flow. Reset the in-progress
flag in `finally`, and on `catch` surface the error + a retry; a failed write must never
permanently disable the only way forward.

> ✅ A panel whose data request errors or exceeds its timeout shows "加载失败" with a
> **Reload** button that refetches. ❌ A `NeuralNetworkLoading` that spins indefinitely when
> the request hangs. ❌ `isInit` set only in the success handler, so a failed fetch leaves
> the skeleton up forever. ❌ The onboarding language step `await setSettings(...)` — the write
> that gates `commonStepsCompleted` — with no try/catch/finally, so a failed write leaves
> `isNavigating` true and Send + Back stay `disabled` forever, trapping the user on the step
> (`ResponseLanguageStep.tsx`); ✅ the desktop `LoginStep` idle/loading/success/error state
> machine with retry + cancel is the shape it should follow. ❌ A builtin-client consent page auto-submits a hidden form on
> mount and renders `Result status="success"` with a spinner + "redirecting…"; if that POST
> fails the user is stuck on a **permanent success-styled spinner** with no retry
> (`OAuthConsent/Consent/BuiltinConsent.tsx`) — a loading state that both can't fail and
> mislabels itself "success". _(pairs with Read §1.1 error state, §4.1 loading visuals.)_
> ❌ The **whole Eval module** wires 9 SWR fetches with an `onSuccess`-only handler and no
> `onError` (`store/eval/slices/{benchmark,dataset,run,testCase}/action.ts`); every list /
> detail ready-flag (`benchmarkListInit`, `isLoadingDatasets`, `isLoadingRuns`, …) flips only
> on success, so one root cause hangs a **permanent skeleton** on the sidebar + bench detail,
> a false-empty on the overview, and a blank on run / case / dataset detail — five surfaces,
> zero error paths.

**Checklist**

- [ ] Every loading state has a terminal failure path — on error or after a bounded timeout, not an infinite spinner. _(Certainty)_
- [ ] An init/ready flag isn't gated on success only — the error path resolves the loading state too, no permanent skeleton. _(Certainty)_
- [ ] An awaited write that gates navigation resets its in-progress flag in `finally` and offers retry on `catch` — a failed write never permanently disables the advance / Back control. _(Certainty)_
- [ ] The failed state names the failure and offers a **Reload / Retry** action. _(Meaningful)_
- [ ] Retry re-runs the same fetch, shows loading while re-running, and stays available on repeat failure. _(Certainty)_
- [ ] Already-loaded context is preserved on failure — don't wipe the surface. _(Meaningful)_
- [ ] In an auto-dismissing surface (upload dock / progress toast), auto-dismiss fires on **success only** — a failed item persists with a Retry, never cleared by the countdown. _(Certainty・Meaningful)_

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

## 4.4 Autosave needs a persistent save-state, and one convention per surface・Certainty・Meaningful

A settings / config surface that **saves on every change** (`onValuesChange → setSettings`,
toggle → store action) has no explicit "Save" button, so the write is invisible — and an
invisible write that **fails silently is a config-loss trap**: the user flips a switch,
sees nothing, believes it took, and it didn't. Autosave therefore owes a **persistent
save-state**, not a fire-and-forget: reflect **saving → saved → failed**, and on failure
show an inline error **with retry** (and keep the user's new value, don't snap the control
back without saying why). A one-shot success toast is optional for a silent-save; a
**failure signal is mandatory** (pairs with §4.2 — the write can fail just like a read).

Just as important, a surface with many such fields must use **one save-feedback
convention**, not a different one per field/tab (consistency is semantic): if changing a
setting here confirms one way, changing a setting there must confirm the same way. A shared
form wrapper is the natural home for this — bake the save-state affordance into the wrapper
so tabs can't each re-invent (or forget) it.

> ✅ An autosave field shows a subtle "saved" tick on success and, on failure, an inline
> "保存失败" with a **Retry** that re-runs the write and keeps the edited value. ❌ The
> Appearance / Advanced / hotkey-essential forms call `setSettings` from `onValuesChange`
> with **no success and no failure feedback** — a failed save is indistinguishable from a
> successful one (`settings/appearance`, `settings/advanced`). ❌ The same settings area
> confirms saves four different ways across tabs (silent / `message.success` /
> `notification.success` / toast-on-test-only) with no shared convention. ❌ The page
> editor's content **and** title/emoji autosave both define a save-state of only
> `idle | saving | saved` — **no `failed` variant** — and their `catch` blocks reset
> `saveStatus` / `metaSaveStatus` back to `idle` (`store/document/slices/editor/action.ts`,
> `PageEditor/store/action.ts`). A network / 500 save failure is then indistinguishable from
> a success (only a lock `CONFLICT` is surfaced); the state machine literally can't
> _represent_ failure, so it can never show it — the silent-write trap baked into the type.

**Checklist**

- [ ] Autosave surfaces a save-state (saving → saved → failed), never a silent write. _(Certainty)_
- [ ] The save-state enum can **represent** failure — a `failed` variant exists and the write's `catch` drives it, not a reset to `idle` / neutral. _(Certainty)_
- [ ] A failed autosave shows an inline error **with retry** and keeps the edited value. _(Meaningful)_
- [ ] One save-feedback convention across a multi-field surface — ideally baked into the shared form wrapper, not re-invented per tab. _(Certainty)_
