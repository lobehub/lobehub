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
for — matching both its **height** and its **typical width proportion**, so a two-line row
keeps a long title line over a shorter subtitle line rather than two equal full-width bars
(which mis-signal the shape and shift as the real, narrower text lands). A generic
full-block / full-card skeleton (or a centred spinner the real content later pushes aside)
is heavier and shifts the layout; an in-place text→skeleton swap is optimal.

> ✅ The **Fleet** sidebar's `SidebarTaskSkeleton` mirrors the real `SidebarTaskItem` row exactly
> — same 28 px square avatar, two stacked text lines sized like the title/subtitle (70 % / 45 %
> width), same padding (`RunningTaskSidebar.tsx`) — so the load→content swap is in-place with no
> relayout. ❌ A bare full-row block or a centred spinner the real rows later push aside.

An **elapsed / progress readout for a long op** (a generation clock, an upload %, "running for
2:14") has a subtler honesty trap than the skeleton: if it counts from **local component
state**, it silently **resets to 0 on remount** — the item scrolls out of a virtual feed and
back, the route is revisited, a re-render remounts the node — and the user sees a minute-long
job claim it just started. Derive the start from a **persisted timestamp keyed by the job id**
(sessionStorage / store), so the readout recovers the _true_ elapsed on remount rather than
lying; and **clear that key when the job leaves the active state** so a finished / removed job
doesn't leak a stale start onto a later one that reuses the slot.

> ✅ The create-page `ElapsedTime` reads `generation_start_time_{generationId}` from
> sessionStorage on mount (writing it once if absent), so a generation's clock survives a remount
> and shows real duration; on `!isActive` it `removeItem`s the key
> (`image/…/GenerationItem/ElapsedTime.tsx:33-49`). ❌ A `useState(0)` counter started in the
> mount effect — every remount restarts the timer at zero.

**Checklist**

- [ ] No antd `Spin`; use `NeuralNetworkLoading` / project loaders. _(Natural)_
- [ ] Skeleton reuses the loaded component's chrome — content swap, not relayout. _(Certainty・Natural)_
- [ ] Skeleton lines match the real text's **height and typical width proportion** (long title line over a shorter subtitle, not equal full-width bars). _(Certainty)_
- [ ] Known-shape surface not downgraded to a bare block / spinner. _(Natural)_
- [ ] A long-op elapsed / progress readout derives from a **persisted start timestamp keyed by job id** (survives remount, shows true duration) and clears the key when the job ends — never a local counter that resets to 0 on remount. _(Certainty・Natural)_

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
The flag is often **disguised as data-presence** — `loaded = Array.isArray(map[id])`, where
`map[id]` is written only in the SWR `onSuccess`: same success-only init flag, just spelled
as "is the data here yet". A failed fetch leaves the entry `undefined` → `loaded` stays
false → permanent skeleton. Don't read "present in a success-populated map" as "loaded";
branch the fetch's real `error`.

The mirror-image trap on a **compound** gate — one that holds the skeleton until a **secondary /
dependent** fetch resolves (a detail that waits on the assignee's config, a row that waits on its
owner) — is gating on that dependency being **present** in the map. When the dependency
legitimately resolves to **absent** (deleted, out-of-scope, `null` by design) it never lands in
the map, so a presence-gate **hangs forever** on a perfectly healthy state. Gate on the dependency
fetch's **in-flight** flag instead: block only while it's genuinely loading, and **release on
settled** — data _or_ resolved-`null` _or_ error alike. "Absent" is a resolved state, not a pending
one.

> ✅ **Task detail** gets the compound gate right: it blocks the skeleton on `agentConfigLoading`
> (the assignee-config fetch's **in-flight** flag), not on the assignee being present in the map, so
> a task whose assignee was deleted / moved out of scope resolves to `null` and **releases** the gate
> instead of spinning forever (`useActiveTaskDetail.ts:66-77`); the task skeleton itself is likewise
> gated on "resolving", not on `data === undefined`.

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
> ❌ The **Memory** (记忆) area repeats it: every `userMemory` fetch registers an `onSuccess`
> only, no `onError` (`store/userMemory/slices/{context,activity,identity,preference,experience}/action.ts`,
> `home/action.ts`, `base/action.ts` `useFetchMemoryDetail`); each list gate `showLoading =
xSearchLoading || !xInit` flips only on success, so a failed load hangs a **permanent skeleton**
> on all five list tabs, a **false-empty** on home, and a **blank panel** on all five detail
> panels — no `*Error` field even exists to branch on. ❌ Its edit modal is the write-side twin:
> `EditorModal onOk` does `setConfirmLoading(true) → await onConfirm → setConfirmLoading(false)`
> with **no try/catch/finally** (`src/features/EditorModal/index.tsx`), so a failed save spins the
> OK button forever and the edit is lost on close. ✅ The same area's `DateRangeModal` submit is the
> model to copy: a `submitting` guard against double-submit + **try/catch/finally** (resets the flag,
> toasts on failure) + success toast then close (`memory/features/MemoryAnalysis/DateRangeModal.tsx`).
> ❌ The **Task list / kanban** repeats the read-side trap: `isTaskListInit` / `isTaskGroupListInit`
> flip true **only** in the SWR `onSuccess` (`store/task/slices/list/action.ts:146-155,110-116`) —
> no `onError`, and the hook's `error` / `isLoading` are **discarded at the call site**
> (`AgentTasksPage.tsx:63`), so a failed `taskService.list()` leaves `!isInit` → the skeleton
> (`TaskList.tsx:203`) spins forever with no retry.
> ❌ The **create / generation** surfaces (视频 / 图像) hit the data-presence-disguised variant:
> `useFetchGenerationBatches` registers **`onSuccess` only, no `onError`**
> (`store/{video,image}/slices/generationBatch/action.ts`), the "loaded" gate is
> `isCurrentGenerationTopicLoaded = Array.isArray(generationBatchesMap[topicId])`
> (`…/selectors.ts:23-27`), and the **shared** shell renders `!loaded` → `<SkeletonList/>` /
> `!hasGenerations` → `<EmptyState/>` / feed with **no error branch**
> (`routes/(main)/(create)/features/GenerationWorkspace/Content.tsx:39-45`). A failed batch
> fetch never populates the map, so the skeleton is permanent with no retry on **both surfaces
> and any future one built on the shell** (the sidebar `useFetchGenerationTopics` is the same
> success-only shape).
> ❌ The **Discover / Community** lists are the trap in its **purest** form — no init flag even
> needed. All 8 list slices register `useSWR(key, fetcher, { revalidateOnFocus: false })` with
> **no `onError`** (`store/discover/slices/*/action.ts`), every call site destructures
> `{ data, isLoading }` and **discards `error`**, then gates `if (isLoading || !data) return <Loading/>` (`community/(list)/agent/index.tsx:18,29` + 7 twins) — so `!data` **is** the
> success-only gate. Worse, the fetcher **suppresses even the fallback toast**
> (`services/discover.ts:117` `{ context: { showNotification: false } }`). A failed market
> fetch → permanent skeleton on the primary content of every Discover tab, no error, no retry,
> no toast (the `mutate` needed to retry is already returned, unused). ✅ Read `error` at the
> call site (or a shared list-shell) and render a failed state with Reload before the `!data`
> branch.
> ❌ The **chat message stream** — the product's highest-traffic surface — has the same trap:
> `useFetchMessages` registers **`onData` only, no `onError`**
> (`store/chat/slices/message/actions/query.ts:216-232`,
> `features/Conversation/store/slices/data/action.ts:211-266`); `messagesInit` flips true only
> in the success `onData` (or via `hasInitMessages = !!dbMessagesMap[key]`,
> `ConversationArea.tsx:95` → `StoreUpdater.tsx:73`), and `ChatList` **discards the SWR
> `error`** (keeps `messagesSWR` but reads only `.isValidating`, `ChatList/index.tsx:97,157`),
> rendering `!messagesInit → <SkeletonList/>` with **no error branch**
> (`ChatList/index.tsx:174`). A failed `getMessages` for a selected topic hangs a **permanent
> skeleton** on the core chat — no reason, no Reload. ✅ Branch the fetch's `error` to a failed
> state with Retry (see the topic audit).

**Checklist**

- [ ] Every loading state has a terminal failure path — on error or after a bounded timeout, not an infinite spinner. _(Certainty)_
- [ ] An init/ready flag isn't gated on success only — the error path resolves the loading state too, no permanent skeleton. _(Certainty)_
- [ ] A compound gate waiting on a **secondary/dependent** fetch gates on its **in-flight** flag and releases on settled (data / resolved-`null` / error), never on the dependency being **present** in a map — a legitimately absent dependency (deleted / out-of-scope) must not hang the gate. _(Certainty)_
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

**Soft-inline is right only when the user can fix it _in context_.** The "never a hard block"
rule above assumes a **model / config** capability — the user switches the model dropdown and
the feature works, so blocking them would be gratuitous. A different class of gap is
**structural**: the capability is absent because of the **platform / deployment**, not a choice
the user can flip on this screen — a build served without the backend the feature needs (no
database, a client-only distribution), a plan that doesn't include the feature. Here there is
nothing to switch, so a soft inline warning over a half-working surface is _worse_ than honest:
render a **full-surface gate** that says the feature isn't available in this context **and
carries the remedy** (how to self-host / enable the backend, upgrade the plan), not a bare "not
supported". The distinction is user-fixable-here → soft inline; not-fixable-here → full gate
with a path out. Both still owe the remedy.

> ✅ The image-generation surface renders `NotSupportClient` — a full-surface explainer with
> feature cards + links to self-hosting-database docs and the hosted app — when the client build
> lacks the DB backend generation needs (`image/NotSupportClient.tsx`), instead of showing a dead
> composer. The remedy is _in the gate_. ❌ A model-capability gap hard-blocking the surface, or
> conversely a platform-absent feature faking a working UI that silently no-ops.

**Checklist**

- [ ] A **model / config** capability gap (user can switch here) shows a soft inline warning, never a hard block. _(Meaningful)_
- [ ] A **platform / deployment** capability gap (not fixable on this screen) shows a full-surface gate **with the remedy** (self-host / enable / upgrade), never a soft warning over a half-working surface or a faked-working no-op. _(Certainty・Meaningful)_
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

**The rule is about surfacing the save-state, not about autosave specifically.** Autosave is
one convention; an **explicit per-field / per-section `Save` button** is another equally
valid one — and sometimes the better fit (a namespace/handle edit that must validate
uniqueness, a field where a mid-typing autosave would thrash). What §4.4 demands holds either
way: whichever you pick, the write must show **saving → saved → failed** (a `Save` button owes
a loading spinner + a success tick + an on-failure inline error that **keeps the edited
value**), and you must pick **one** convention for the surface, not mix autosave-here /
explicit-Save-there. Choosing explicit Save doesn't exempt you from the failure signal — it
just moves it onto the button.

> ✅ An autosave field shows a subtle "saved" tick on success and, on failure, an inline
> "保存失败" with a **Retry** that re-runs the write and keeps the edited value.
> ✅ **Community workspace settings** takes the explicit-Save route and does it right: each
> field has its own `Save` button driving a `savingField` loading state, a success toast, and
> an on-failure `message.error` (plus an inline field error for the namespace-taken case) that
> **keeps the edited value** rather than snapping it back — one convention applied across every
> field of the surface (`CommunityWorkspaceSettings.tsx:310-352`). Explicit Save, full
> save-state, no silent write — the discipline the same area's read side lacks (see Read §1.1). ❌ The
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
> ❌ **Task detail** config autosave is the same trap twice over: `updateVerifyConfig` /
> `updateTaskModelConfig` / `updatePeriodicInterval` / `setAutomationMode` / `updateSchedule` all
> catch-and-`console.error` (`store/task/slices/config/action.ts:121-132,151-167,224-229,279-284`)
> — the optimistic engine reverts the value with **no toast** — and `taskSaveStatus` is
> `saving | saved | idle` with **no `failed`**, reset to `idle` on error (`detail/action.ts:284`),
> while the header renders `AutoSaveHint` only while `saving` (`TaskDetailPage.tsx:68`). A failed
> schedule / verify / model edit looks identical to a saved one.

**Checklist**

- [ ] Save-state surfaced (saving → saved → failed), never a silent write — whether autosave **or** an explicit per-field/section `Save` button (explicit Save still owes the failure signal). _(Certainty)_
- [ ] The save-state enum can **represent** failure — a `failed` variant exists and the write's `catch` drives it, not a reset to `idle` / neutral. _(Certainty)_
- [ ] A failed autosave shows an inline error **with retry** and keeps the edited value. _(Meaningful)_
- [ ] One save-feedback convention across a multi-field surface — ideally baked into the shared form wrapper, not re-invented per tab. _(Certainty)_
