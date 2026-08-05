# Worked example — Task detail /run-monitor (任务详情) audit

A real run of this skill against the **single-task detail** — the cross-agent `/task/:taskId`
and its agent-scoped twin `/agent/:aid/task/:taskId`, 2026-07 (LOBE-11220). The detail doubles as
an **async agent-run monitor**: a live activity feed, subtasks, comments, artifacts, and
schedule / verify / model config. Use it as a template for the output shape, not as current-state
truth (the code moves; re-verify before citing).

> **Sibling of the tasks list.** This detail and the [tasks list](tasks.md) share one store and
> one feature package but are **different surfaces**, so one report each. The **cross-surface
> seam** (detail edits leaving the list row stale) is owned in [`tasks.md`](tasks.md) as gap L③;
> it's the detail's `updateTask` that causes it, cross-referenced here. The combined run's `ux`
> 回灌 is already landed (§4).

**Both route trees delegate to one component.** `agent/:aid/task/:taskId`
(`desktopRouter.config.tsx:130-136`) and `/task/:taskId` (`:650-663`, router `errorElement`
`resetPath="../tasks"` at `:661`) both render `TaskDetailPage`
(`routes/(main)/agent/task/[taskId]/index.tsx`, `routes/(main)/task/[taskId]/index.tsx`). One
detail surface, audited once.

**Surface class:** async-job / agent-run monitor + editable record — benchmark against Devin /
GitHub Actions run pages / cron dashboards (run · pause · **stop/abort** · retry · live log ·
schedule) **and** an editable issue detail (title · priority · assignee · autosave).
**Layers run:** L1 (static / code) ✅ — everything below. L2 / L3 ⏳ not yet run — see §5.

**Load-bearing files:** `features/AgentTasks/AgentTaskDetail/{TaskDetailPage,TaskDetailSections,
useActiveTaskDetail,TaskDetailRunPauseAction,TaskDetailHeaderActions,TaskActivities,TaskSubtasks,
TaskVerifyConfig,TaskInstruction,TaskArtifacts,TaskParentBar,CommentInput,TopicCard}`,
`shared/Breadcrumb.tsx`, `store/task/slices/{detail,lifecycle,config}/action.ts`,
`store/task/slices/detail/initialState.ts`, `store/task/selectors/detailSelectors.ts`,
`components/Editor/AutoSaveHint.tsx`.

## 1 — Patterns in use

| Pattern (family)                    | Where                                                                  | Rating | Note                                                       |
| ----------------------------------- | ---------------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| Loading state machine (feedback)    | compound gate (`useActiveTaskDetail.ts:63-78`)                         | ✅     | skeleton on "resolving", not `data===undefined` — **亮点** |
| Live activity feed (data)           | `TaskActivities.tsx` + reactive 10 s poll (`detail/action.ts:300-315`) | ✅     | polls only in-flight; real empty — **亮点**                |
| Not-found / 404 (data)              | `TaskDetailPage.tsx:39-59`                                             | ⚠️     | real screen, but **failed-load reads as 404** (gap D②)     |
| Run / pause / stop / retry (act)    | `TaskDetailRunPauseAction.tsx`, `TopicCard.tsx`                        | ⚠️     | works; **start/stop failures silent** (gap D①)             |
| Cancel a running job (act)          | header "Stop" = set `paused`; real abort only per-topic                | ⚠️     | **no task-level abort; buried per-topic** (gap D④)         |
| Autosave / editable-in-place (edit) | title, instruction, verify / model / schedule config                   | ⚠️     | **no `failed` state; config saves silent** (gap D③)        |
| Run-all bulk flow (act)             | `TaskSubtasks.tsx:204-255`                                             | ✅     | preview → locked confirm → partial/kicked toast — **亮点** |
| Comment / feedback (edit)           | `CommentInput.tsx`, `CommentCard.tsx`                                  | ⚠️     | draft safe on failure ✅; **no failure toast** (gap D⑤)    |
| Confirmation (act)                  | delete / brief / artifact / stop-topic / run-all                       | ✅⚠️   | broad; **task-level Stop unconfirmed** (gap D④)            |
| Deep-link / breadcrumb (nav)        | `shared/Breadcrumb.tsx`; copy-link                                     | ✅     | present on both normal + not-found                         |
| Elapsed / countdown readout (fb)    | topic elapsed / next-run countdown                                     | ✅     | derived from **persisted** timestamps, not a local counter |
| Section empty states (data)         | artifacts hide-on-zero (`TaskArtifacts.tsx:124`)                       | ⚠️     | whole section vanishes (gap D⑥, pending L2)                |

**Read:** the **read/monitor spine is mature** — the loading/not-found gate machine, reactive
live polling, run-all preview, broad confirmations, persisted elapsed readouts. The weakness
clusters hard in **write feedback**: run/pause/create (D①), a transient fetch error masquerading
as deletion (D②), config autosave that structurally can't report failure (D③), no real run abort
(D④), silent comment failure (D⑤), and a few section-polish / i18n gaps (D⑥).

## 2 — Strengths / good cases (don't regress)

The read/monitor spine is the model half of this surface — these already landed as ✅ examples in
`ux` (the combined run), and are the "don't regress" list for the write-path refactor:

- **✅ 亮点 — Loading /not-found state machine (landed as ux Feedback §4.2 ✅).**
  `useActiveTaskDetail.ts` gates the skeleton on "resolving" (`isTaskResolving = !hasTaskDetail &&
!isNotFound`, `:63`), **not** on `data === undefined`, and the assignee-config gate keys off the
  fetch's **in-flight** flag (`agentConfigLoading`, `:72-73`), so an assignee that resolves to
  `null` (deleted / out-of-scope) **releases** the gate instead of deadlocking. Extracted the
  compound-gate sub-rule into §4.2. (The one soft spot: a transient _error_ still coerces to 404 —
  gap D②; the gate machine itself is the model.)
- **✅ 亮点 — Live polling without the `refreshInterval` trap (landed as ux Read §1.7 ✅).** the
  activity feed polls 10 s **only while** `hasInFlightActivity`, via a reactive-boolean `shouldPoll`
  feeding `refreshInterval` (`detail/action.ts:300-315`, `:48-57`) rather than a function-valued
  `refreshInterval` — dodging SWR's cold-start trap and stopping the moment the run goes idle.
- **✅ 亮点 — Run-all flow — the mutation model (landed as ux Act §3.1 ✅).**
  `TaskSubtasks.tsx:204-255` runs preview → **locked confirm** → `partialFailure` vs `kickedOff`
  toasts, with a real outer try/catch + error toast — so a bulk run tells the user exactly what
  happened even on partial success. The model every other mutation here should copy (most don't —
  gaps D①D⑤).
- **✅ 亮点 — Comment draft preserved on failure.** the comment editor is cleared **only after**
  `await` resolves (`CommentInput.tsx`), so a failed post keeps the typed draft rather than eating
  it — the draft-safety half is already right (the missing half is the failure toast — gap D⑤).
- **✅ 亮点 — Persisted elapsed /countdown readouts.** the running-topic elapsed
  (`TopicCard.tsx:45-59`) and the scheduled next-run countdown (`TaskDetailRunPauseAction.tsx:110-135`)
  both derive from **persisted** timestamps (`activity.time`, `heartbeat.lastAt`, the cron pattern),
  with a 1 s ticker only advancing the display — so a remount shows true elapsed, not a reset-to-0.
- **✅ — Broad confirmation coverage.** delete / brief / artifact / stop-topic / run-all are all
  confirm-gated; the gap is _consistency_ (the task-level Stop is the one sibling left unconfirmed —
  gap D④), not absence.

## 3 — Experience gaps (ranked)

**D① Run / Pause / Run-now failures are silent — Act §3.1 / Feedback §4.2** 🔴
`runTask` catches and only `console.error`s (`store/task/slices/lifecycle/action.ts:49-52`) — no
re-throw, no toast; its callers `handleRunOrPause` / `handleRunNow` use `try/finally` with **no
catch** (`TaskDetailRunPauseAction.tsx:59-67`, `:83-91`). Because `runTask` never rejects, a failed
run resolves normally, `finally` clears `isStarting`, and the next refresh reverts the optimistic
`status:'running'` — so the button **silently snaps back to "Run"** with no error. The pause path
(`updateTaskStatus(taskId,'paused')`) rethrows but the caller still has no catch, so a failed pause
is equally silent. The job-control twin of the optimistic-mutation rule: a run/pause/stop that only
logs its failure reads as a dead button. _Remedy:_ toast at the store-action boundary (copy the
run-all flow). **Filed as sub-issue.**

**D② Failed task-detail fetch masquerades as "Task not found" (404), no retry — Read §1.1** 🟠
`fetchTaskDetail` throws `Task not found` when `result.data` is falsy **and** lets any network / 500
rejection propagate the same way (`store/task/slices/detail/action.ts:124-129`);
`useActiveTaskDetail.ts:60` then sets `isNotFound = !!taskError && !hasTaskDetail`, and
`TaskDetailPage.tsx:39-59` renders a terminal `NotFound` whose only action is a "Back to tasks"
`Link` (`:51-53`). A transient failure (after SWR retries) therefore tells the user the task was
**deleted** and offers **no Reload** — deleted vs failed-to-load conflated (the comment at
`useActiveTaskDetail.ts:49-51` reasoned only about the missing case). _Remedy:_ distinguish a
thrown "not found" → 404 from a fetch rejection → reload state; read `error` before falling to
`NotFound`. (The rest of this machine is the §2 model.)

**D③ Config autosave fails silently; the save-state can't represent failure — Feedback §4.4** 🟠
`updateVerifyConfig`, `updateTaskModelConfig`, `updatePeriodicInterval`, `setAutomationMode`,
`updateSchedule` all catch-and-`console.error` (`store/task/slices/config/action.ts:121-132,
135-156,160-167,172-230,235-285`); the optimistic engine reverts the value with no toast.
Compounding it, `taskSaveStatus` is `'idle' | 'saving' | 'saved'` with **no `failed`**
(`slices/detail/initialState.ts:9`); on error it resets to `'idle'` (`detail/action.ts:284`,
`config/action.ts:153`, `lifecycle/action.ts:106`), and the header renders `AutoSaveHint` **only
while `saving`** (`TaskDetailPage.tsx:68`) — `AutoSaveHint` itself has no failed state
(`components/Editor/AutoSaveHint.tsx`). So a failed verify / schedule / model save looks identical
to a saved one. (`updateTask` — title/assignee — is the one exception that toasts,
`detail/action.ts:286-291`.) The same type-level trap as agent-profile and the page editor.
_Remedy:_ add `failed` to the enum + an inline retry keeping the edited value; drive it from the
config `catch`. **Filed as sub-issue.**

**D④ No true task-level abort; header "Stop" is unconfirmed and gives no feedback — Act §3.1 / §3.4** 🟠
The header "Stop" (`TaskDetailRunPauseAction.tsx:189-200`) calls `updateTaskStatus(taskId,'paused')`
— it flips the DB status to `paused` with **no confirm and no success toast**, and there is **no
task-level run abort**: the only real cancel is per-topic (`cancelTopic`, `lifecycle/action.ts:23-27`)
buried behind the activity feed's `TopicCard` "Stop Run" confirm (`TopicCard.tsx:74-89`). So to
actually abort an in-flight run the user must hunt the running topic card, while the prominent
"Stop" only pauses — and the per-topic stop confirms while the task-level one doesn't
(consistency-is-semantic). Absent cancel is a class-norm miss for a run-monitor (Devin / Actions all
abort a running job). Also `TaskDetailRunPauseAction.tsx:178` returns `null` on a terminal task, so
the run-control region reads empty with no "what now" (pending L2). _Remedy:_ wire a real
task-level abort into the in-progress state; confirm it consistently with the per-topic stop.
**Filed as sub-issue.**

**D⑤ Comment / instruction submit failures are silent — Act §3.1 / Feedback §4.4** 🟡
`addComment` has no catch and doesn't toast (`store/task/slices/detail/action.ts:76-89`);
`CommentInput` / `CommentCard.handleSave` await it in `try/finally` with no catch. The draft is safe
(editor cleared only after `await` — the §2 good case), but the failed post is an unhandled
rejection with no message. Instruction autosave is the D③ shape. _Remedy:_ toast the failure at the
action boundary; keep the (already-preserved) draft.

**D⑥ Section polish — artifacts hide-on-zero, parent-bar swallows error, hardcoded i18n — Read §1.1 / i18n** 🟡
`TaskArtifacts.tsx:124` returns `null` on zero artifacts — the whole section vanishes, so "no
artifacts yet" is indistinguishable from "feature missing"; `TaskParentBar.tsx:57-60` swallows a
parent-fetch error and silently shows `backlog`; and several strings bypass locale files
(`TopicCard.tsx:79-88` stop-run confirm, `detail/action.ts:287` "Failed to update task",
`TaskArtifacts.tsx:36` `'Untitled'`). _Remedy:_ render a labeled empty for artifacts; surface the
parent error; move literals to locales. **(confirm the section-vanish on render — L2.)**

_Cross-surface:_ the detail's `updateTask` leaving the **list row stale** (two un-normalized caches,
gated refresh — `detail/action.ts:295-297`) is owned as **gap L③ in [`tasks.md`](tasks.md)**.

## 4 — Skill feedback (回灌)

- **Already landed by the combined run (validated-existing here):** Feedback **§4.2** ✅ compound-gate
  sub-rule (the §2 loading machine); Read **§1.7** ✅ conditional-polling sub-rule (the §2 reactive
  poll); Act **§3.1** ✅ run-all + ❌ job-control (gap D①); Read **§1.1** ❌ error-as-not-found (gap
  D②); Feedback **§4.4** ❌ no-`failed` save-state (gap D③). All already cite this surface.
- **No new generalizable rule from this split run.** Gap D④ (no task-level abort; real cancel buried
  per-topic) is a fresh **instance** of the already-landed Act §3.1 cancel-class norm ("a
  long-running op offers Cancel while it runs, not delete-after"), not a missing distinction — so it's
  recorded as an ❌ example, not re-landed. D⑤/D⑥ are validated-existing (Act §3.1, Read §1.1, i18n).
- The 回灌 loop for this surface pair was closed by the combined run; this split verifies the rules
  still hold at current line numbers and re-homes the ❌ examples per surface.

## 5 — Pending: L2 visual + L3 dynamic

- **L2 (visual)** — whether a terminal-state task's detail (run-control `null`, gap D④) leaves an
  obvious next action; the artifacts total-hide (gap D⑥); how the not-found screen reads vs a real
  404; narrow-width + dark-mode.
- **L3 (dynamic)** —
  - Force the detail fetch to 500 → **confirm gap D②** (shows "Task not found", no reload).
  - Force a run start / pause to fail → **confirm gap D①** (button snaps back, no toast).
  - Force a schedule / verify / model save to fail → **confirm gap D③** (value reverts silently, hint gone).
  - Try to abort a running task from the header → **confirm gap D④** (only pauses; real cancel is per-topic).
  - **Measure the activity-feed poll's effect on INP** while a run streams.
