# Worked example — Task Workspace (`/tasks` list + `/task/[id]` detail) audit

A real run of this skill against the **Task Workspace** (`@/features/AgentTasks`), 2026-07 —
an agent task board: a cross-agent list/kanban (`/tasks`) + a single-task detail that doubles
as an **async agent-run monitor** (`/task/[taskId]`) with a live activity feed, subtasks,
comments, artifacts, and schedule / verify config. Use it as a template for the output shape,
not as current-state truth (the code moves; re-verify before citing).

**One pair of surfaces, two entry points (not a duplicate).** The audit resolved the parent
issue's warning: the "Chat-side" tasks routes (`agent/:aid/tasks`, `agent/:aid/task/:taskId`,
`desktopRouter.config.tsx:121-136`) and the standalone workspace routes (`/tasks`,
`/task/:taskId`, `:637-669`) **delegate to the same components** — `AgentTasksPage` and
`TaskDetailPage` — parameterized by `agentId` / `showTaskAgentPanelToggle`
(`routes/(main)/tasks/index.tsx`, `.../agent/tasks/index.tsx`, `.../task/[taskId]/index.tsx`).
So this is **one** list surface + **one** detail surface, audited once.

**Surface class:** agent task board / issue tracker + async-job monitor — benchmark against
Linear / Asana (list · kanban · grouping · priority · assignee) **and** Devin / GitHub Actions
run pages / cron dashboards (run · pause · stop · retry · live log · schedule).
**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic + CLS)
⏳ not yet run — see §5. Verdicts about the render are L1 inferences here, pending L2.

**Load-bearing files:** `features/AgentTasks/AgentTaskList/{AgentTasksPage,TaskList,KanbanBoard,
KanbanColumn,EmptyState,CreateTaskInlineEntry}`, `AgentTaskDetail/{TaskDetailPage,
useActiveTaskDetail,TaskDetailRunPauseAction,TaskDetailHeaderActions,TaskActivities,TaskSubtasks,
TaskVerifyConfig,TaskInstruction,CommentInput,TopicCard}`, `CreateTaskModal/*`,
`store/task/slices/{list,detail,lifecycle,config}/action.ts`, `services/task.ts`,
`apps/server/src/routers/lambda/task.ts`.

## 1 — Patterns in use

| Pattern (family)                      | Where                                                                                         | Rating | Note                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| Overview + Detail (nav)               | list rows → `taskDetailPath` (`AgentTaskItem.tsx:65`); detail sections                        | ✅     | click row opens detail                                     |
| Deep-linking / breadcrumb (nav)       | `shared/Breadcrumb.tsx`; copy-link (`HeaderActions.tsx:49`, `useTaskItemContextMenu.tsx:202`) | ✅     | workspace-aware absolute URL                               |
| List ⇄ Kanban toggle (nav)            | `TasksGroupConfig.tsx:163`, persisted `setViewMode`                                           | ✅     | view choice sticks                                         |
| Grouping / sub-grouping / sort (data) | `TaskList.tsx:143-201`, `listViewOptions.ts`                                                  | ⚠️     | rich — but **client-side over ≤50 rows** (gap ⑤)           |
| Empty-as-onboarding (growth)          | `EmptyState.tsx` (greeting + inline create + templates)                                       | ✅     | strong onboarding hero — highlight                         |
| Loading Skeleton (feedback)           | list `TaskList.tsx:203`, kanban `KanbanColumn.tsx:253`, detail `useActiveTaskDetail`          | ⚠️     | detail solid; **list can't fail** (gap ①)                  |
| **Failure + Retry (feedback)**        | list fetch / detail fetch                                                                     | — abs. | the surface's dominant gap (①②)                            |
| Live activity feed (data)             | `TaskActivities.tsx` + 10s poll (`detail/action.ts:48`)                                       | ✅     | reversed chronological, real empty                         |
| Not-found / 404 (data)                | `TaskDetailPage.tsx:39-59`                                                                    | ⚠️     | real screen, but **failed-load reads as 404** (gap ②)      |
| Optimistic mutation (act)             | kanban drag (`KanbanBoard.tsx:133`), status, delete                                           | ⚠️     | some roll back + toast, most log-only (gaps ③④⑥⑦⑧)         |
| Run / pause / stop control (act)      | `TaskDetailRunPauseAction.tsx`, `TopicCard.tsx`                                               | ⚠️     | works, but start/stop failures silent (gap ③)              |
| Editable-in-place / autosave (edit)   | title, instruction, comment, config                                                           | ⚠️     | debounced save, **no `failed` state** (gaps ④⑥)            |
| Confirmation (act)                    | delete / brief / artifact / stop-topic / run-all                                              | ✅⚠️   | broad; **task-level Stop unconfirmed** (gap ⑨)             |
| Context menu (act)                    | `useTaskItemContextMenu.tsx` (status/priority/run/copy/delete)                                | ✅⚠️   | complete; menu run/status failures silent (gap ⑦)          |
| Inline create + modal (act/edit)      | `CreateTaskInlineEntry.tsx`, `CreateTaskModal/*`                                              | ⚠️     | create failure silent (③); **draft not persisted** (gap ⑩) |

**Read:** the **read/monitor spine is mature** (detail state machine, live polling, activity
feed, confirmations). The weakness clusters hard in **Feedback** — every fetch that can hang has
no retry (①②), and **nearly every write swallows its failure** (create ③, run/pause ③, delete ④,
config/status autosave ④, comment/menu ⑦⑧): a catch that only `console.error`s, or a re-throw
into an uncaught handler, so the optimistic UI reverts with no word to the user. Plus a
**Read-at-scale** cap (⑤) — the list silently truncates at 50.

## 2 — Strengths / good cases (don't regress)

The read/monitor spine is mature — these are the ✅ half of the 回灌 loop and the "don't regress"
list for the next refactor (which is mostly write-path work, so it's easy to nick these). **Three
land as ✅ examples in the `ux` checklists** (see §4):

- **✅ 亮点 — Detail loading /not-found state machine (→ landed as ux Feedback §4.2 ✅).**
  `useActiveTaskDetail.ts` gates the skeleton on "resolving", **not** on `data === undefined`, and
  the assignee-config gate keys off the fetch's **in-flight** flag (`agentConfigLoading`, `:66-77`),
  so an assignee that resolves to `null` (deleted / out-of-scope) **releases** the gate instead of
  deadlocking — a task with no assignee still renders instead of spinning forever. Extracted a
  latent **compound-gate** sub-rule into Feedback §4.2. (The one soft spot: a _transient fetch
  error_ still coerces to "Task not found" — gap ②; the gate machine itself is the model.)
- **✅ 亮点 — Live polling without the `refreshInterval` trap (→ landed as ux Read §1.7 ✅).** the
  activity feed polls 10s **only while** `hasInFlightActivity`, driven by a **reactive-boolean**
  `shouldPoll` selector feeding `refreshInterval` (`detail/action.ts:300-315`) rather than a
  function-valued `refreshInterval` — so it dodges SWR's cold-start trap (the function form never
  schedules a first timer if its initial value is `0`) and stops the moment the run goes idle.
  Extracted the "conditional polling starts from reactive state" sub-rule into Read §1.7.
- **✅ 亮点 — Run-all flow — the mutation model (→ landed as ux Act §3.1 ✅).** `TaskSubtasks.tsx:204-255`
  runs preview → **locked confirm** → `partialFailure` vs `kickedOff` toasts, so a bulk run tells
  the user exactly what happened even on partial success. This is cited as the **✅** for Act §3.1
  and is the model every other mutation on this surface should copy (they mostly don't — gaps
  ③⑦⑧).
- **✅ 亮点 — Comment draft preserved on failure.** the comment editor is cleared **only after**
  `await` resolves, so a failed post keeps the typed draft in place rather than eating it — the
  draft-safety half of the write path is already right (the missing half is the failure _toast_ —
  gap ⑥).
- **✅ 亮点 — Broad confirmation coverage.** destructive / disruptive actions across the surface —
  delete, brief, artifact, stop-topic, run-all — are gated behind confirms (Confirmation row, §1
  table). The gap is _consistency_, not absence: the task-level Stop is the one sibling left
  unconfirmed (gap ⑨).

## 3 — Experience gaps (ranked)

**① List / kanban fetch failure → permanent skeleton, no retry — Feedback §4.2** 🔴
`isTaskListInit` / `isTaskGroupListInit` flip to `true` **only** in the SWR `onSuccess`
callback (`store/task/slices/list/action.ts:146-155`, `:110-116`); there is **no `onError`**, and
the hook's `error` / `isLoading` are **discarded at the call site** (`AgentTasksPage.tsx:63` calls
`useFetchTaskList(...)` without assigning the return). `TaskList.tsx:203` / `KanbanBoard.tsx:203`
render the skeleton on `!isInit`. So when `taskService.list()` exhausts SWR's retries, `isInit`
stays `false` **forever** → skeleton spins with no error, no retry. The init-flag-gated-on-success
trap — identical to the Eval module's nine-fetch version.

**② Failed task-detail fetch masquerades as "Task not found" (404), no retry — Read §1.1** 🟠
`fetchTaskDetail` throws `Task not found` when `result.data` is falsy **and** propagates any
network / 500 rejection the same way (`detail/action.ts:124-129`); `useActiveTaskDetail.ts:60`
then sets `isNotFound = !!taskError && !hasTaskDetail`, and `TaskDetailPage.tsx:39-59` renders a
terminal `NotFound` whose only action is "Back to tasks". A transient fetch failure (after SWR
retries) therefore tells the user the task was **deleted** and offers **no Reload** — deleted vs
failed-to-load conflated. The code comment (`useActiveTaskDetail.ts:49-51`) reasoned only about
the missing case, not the errored one. (The rest of this machine is good — see Strengths.)

**③ Run / Pause / Run-now / Create failures are silent — Act §3.1 / Feedback §4.2** 🔴
`runTask` catches and only `console.error`s (`lifecycle/action.ts:49-52`) — no re-throw, no
toast; its callers `handleRunOrPause` / `handleRunNow` use `try/finally` with **no catch**
(`TaskDetailRunPauseAction.tsx:60-67`, `:84-91`). A failed run rolls the optimistic
`status: 'running'` back on refresh, so the button **silently snaps back to "Run"** with no
error. The **pause** path (`updateTaskStatus(taskId, 'paused')`) and **createTask**
(`detail/action.ts:150-174`, `try/finally` no catch; callers `CreateTaskInlineEntry.tsx:126`,
`CreateTaskContent.tsx:83` don't catch) are the same shape — an unhandled rejection, zero
feedback, on the surface's primary action. This is the **job-control** twin of the optimistic-
mutation rule: a run/pause/stop/retry that only logs its failure reads as a dead button.

**④ Config & status autosave fail silently; the save-state can't represent failure — Feedback §4.4** 🟠
`updateVerifyConfig`, `updateTaskModelConfig`, `updatePeriodicInterval`, `setAutomationMode`,
`updateSchedule` all catch-and-`console.error` (`config/action.ts:121-132,151-167,224-229,279-284`),
as does `TaskVerifyConfig.doSave` (`:202-204`) and `TaskInstruction`'s debounced save
(`TaskInstruction.tsx:98-100`). The store's optimistic engine reverts the value on failure but
says nothing — a silent-write trap. Compounding it, `taskSaveStatus` is `saving | saved | idle`
with **no `failed`**: on error `updateTask` / `#transitionStatus` reset to `idle`
(`detail/action.ts:284`, `lifecycle/action.ts:106`), and the header renders `AutoSaveHint` only
while `saving` (`TaskDetailPage.tsx:68`) — the enum literally can't represent failure.
(`updateTask` itself does toast — `detail/action.ts:286` — the one exception.)

**⑤ List sort / group / filter run client-side over a 50-row cap; no load-more — Read §1.2** 🟠
The server caps the list at `limit` default **50**, max 100 (`apps/server/src/routers/lambda/
task.ts:99`), and the store's `fetchTaskList` passes **no** limit/offset, so exactly 50 rows load
while `tasksTotal` (`data.total`) can be larger. `TaskList.tsx:135-201` then filters, sorts, and
groups **entirely in-memory over those 50** — with **no pagination, no virtualization, no
load-more**. A user with 60 tasks sees 50, and any sort/group silently orders a partial set (the
paginated-sort-client-side trap). Each visible row _also_ fires its own
`useFetchTaskDetail(task.identifier)` (`AgentTaskItem.tsx:47`) → up to 50 detail requests per
list paint.

**⑥ Instruction / comment / feedback submit show no failure — Act §3.1 / Feedback §4.4** 🟡
`addComment` has no catch and doesn't toast (`detail/action.ts:76-89`); `CommentInput` /
`CommentCard.handleSave` / `FeedbackInput` await it in `try/finally` with no catch
(`CommentInput.tsx:57-65`, `CommentCard.tsx:97-104`). Draft is safe on the comment path (editor
cleared only after `await` resolves — good), but the failed post is an unhandled rejection with no
message. Instruction autosave is the §④ shape.

**⑦ Context-menu run / status changes are fire-and-forget — Act §3.1** 🟡
The context menu calls `void updateTaskStatus(...)` (`useTaskItemContextMenu.tsx:114`) and
`runTask` (which only logs); kanban drag reverts visually but shows no toast
(`KanbanBoard.tsx:139-141`). A failed status/run from the menu gives no feedback. (Status does
flip `taskSaveStatus`, but that's surfaced only on the detail page.)

**⑧ Delete-task failure is silent, and optimistic-before-confirm — Act §3.1** 🟡
`deleteTask` optimistically removes the row (`detail/action.ts:180`), then on failure rolls back
and **re-throws** with no toast (`:190-198`); the confirm modal's `onOk`
(`TaskDetailHeaderActions.tsx:38-41`) doesn't catch, so a failed delete rejects silently and the
navigate to `/tasks` is skipped — the detail page flickers out and back with no explanation.

**⑨ Task-level "Stop" is unconfirmed and gives no feedback — Act §3.1** 🟡
The header Stop (`TaskDetailRunPauseAction.tsx:189-200`) pauses the whole task with **no confirm
and no success toast**, while the per-topic "Stop Run" **is** confirmed (`TopicCard.tsx:77-89`).
Stopping an in-progress agent run is disruptive; the two sibling stop controls should confirm
consistently (consistency-is-semantic).

**⑩ Create draft not persisted — modal `maskClosable` / collapse loses typed content — Edit §2.1** 🟡
`CreateTaskContent` and `CreateTaskInlineEntry` hold draft in local `useState`
(`CreateTaskContent.tsx:51`, `CreateTaskInlineEntry.tsx:64`); the modal is `maskClosable: true`
(`CreateTaskModal/index.tsx:11`), so a stray backdrop click discards everything typed with no
warning, and the minimize→inline handoff opens a fresh inline entry rather than carrying the
draft. (Twin of the home-composer in-memory-draft ❌ already in Edit §2.1.)

**⑪ Section polish — Read §1.1 / Act §3.2** 🟡
`TaskArtifacts.tsx:124` returns `null` on zero artifacts — the whole section vanishes, so "no
artifacts yet" is indistinguishable from "feature missing"; `TaskParentBar.tsx:57-60` swallows a
parent-fetch error and silently shows `backlog`; and `TaskDetailRunPauseAction.tsx:178` returns
`null` when a task is terminal (`completed`/`failed`/`canceled`) so the run-control region reads
empty with no "what now" — **confirm on the render (L2)**, don't conclude from the code.

**⑫ Hardcoded English `defaultValue` / raw literals — i18n** 🟡
Several user-facing strings bypass locale files: `TopicCard.tsx:79-88` (stop-run confirm),
`TopicChatDrawer/index.tsx:150,157,185` (copy-id labels), `detail/action.ts:287` ("Failed to
update task"), `TaskArtifacts.tsx:36` (`node.title || 'Untitled'`). They only show if a `zh-CN`
key is missing, but the `defaultValue` fallbacks flag keys that may be absent.

**⑬ Detail edits don't propagate to the list — two un-normalized caches — Act §3.1 (cross-surface)** 🟠
The list reads a `tasks` array (`useFetchTaskList` `onSuccess`); the detail reads `taskDetailMap`;
`updateTaskDetail` patches only the map (`detail/reducer.ts:74`). Sync is a full `refreshTaskList()`
(`list/action.ts:67`) mounted on _some_ paths (run / status / create / delete) but **gated** on
`updateTask` to fire only when assignee / parent changed (`detail/action.ts:295-297`). So editing a
task's **title / priority / model / instruction** from the detail leaves the list row **stale** —
visible when list + detail are mounted together (Chat portal) or on cached back-navigation
(`revalidateOnFocus:false`). Fix: one normalized map, or invalidate the list on every successful
write. **This is a seam _between_ the two surfaces — see the method note below.**

> ⚠️ **Method blind spot this run hit.** ⑬ was missed on the first pass because the audit was split
> into a per-surface list reader and a per-surface detail reader, each told to ignore the other — so
> the shared-store seam (list `tasks` vs detail `taskDetailMap`, stitched by a gated `refreshTaskList`)
> was owned by neither, and the ux-audit checklists have no cross-surface / cache-coherence item. When
> a surface pair edits + lists the **same entity**, add a reader that owns the seam (the shared store),
> or the split-by-surface fan-out will silently drop coherence bugs.

## 4 — Skill feedback (回灌)

- **Landed as strengthened `ux` items** from this audit:
  - Act **§3.1** — the optimistic-mutation bullet is extended to **run / pause / stop / retry
    job-control** actions, with a task-workspace ❌ (`runTask` console.error-only,
    `lifecycle/action.ts:49-52` + uncaught `handleRunOrPause`) vs ✅ (`TaskSubtasks` run-all)
    (gaps ③⑦). Mirrored into the Quick review.
  - Read **§1.1** — new ❌ example: task detail coerces a transient fetch error into a permanent
    "Task not found" via a fetcher that throws on both missing-and-errored + `isNotFound =
!!error` (`fetchTaskDetail`, `useActiveTaskDetail.ts:60`) (gap ②).
  - Feedback **§4.2** — new ❌ example: task list `isTaskListInit` set only in `onSuccess` with
    the hook's `error` discarded at the call site (gap ①).
  - Feedback **§4.4** — new ❌ example: task config autosave (verify / schedule / model /
    interval) catches-and-logs, and `taskSaveStatus` has no `failed` variant (gap ④).
  - Act **§3.1** — new **cross-surface coherence** rule + ❌ example: list `tasks` array and detail
    `taskDetailMap` are two un-normalized copies, and `updateTask` refreshes the list only for
    assignee / parent, so a detail title/priority edit leaves the list row stale (gap ⑬). Mirrored
    into the Quick review. Plus a method note (⚠️ under gap ⑬): split-by-surface fan-out needs a
    reader that owns the shared-store seam, or it drops coherence bugs by construction.
- **Good cases landed as ✅ examples (the ✅ half of 回灌 — each sharpened a rule, not just decorated it):**
  - Feedback **§4.2** — new **compound-gate** sub-rule + ✅: a gate waiting on a _secondary/dependent_
    fetch must key off its **in-flight** flag and release on resolved-absent (`null`), never on the
    dependency being present in a map. Extracted from `useActiveTaskDetail.ts:66-77` (the assignee-
    config gate) — the current rule only covered a primary fetch's success-only init flag; this adds
    the "absent dependency is a resolved state, not a pending one" distinction. Checklist line added.
  - Read **§1.7** — new **conditional-polling** sub-rule + ✅: start polling from **reactive state**
    (`shouldPoll` boolean → `refreshInterval`), not a function-form `refreshInterval` (which never
    schedules a first timer if the initial value is `0`, so polling silently never starts). Extracted
    from `detail/action.ts:300-315`. Checklist line added.
  - Act **§3.1** — the **run-all** flow (`TaskSubtasks.tsx:204-255`) is cited as the ✅ for the
    job-control rule (preview → locked confirm → `partialFailure` vs `kickedOff` toasts).
- **Validated existing rules** (good ❌ examples to cite): Read §1.2 sort/search over a
  partial paginated page (gap ⑤); Edit §2.1 in-memory draft lost on close (gap ⑩); Act §3.2
  terminal-state control visibility (gap ⑪, pending L2). Good ✅ instance already covered by an
  existing rule (cited, not re-landed): comment-draft-preserved-on-failure (Edit §2.1).

## 5 — Pending: L2 visual + L3 dynamic

L1-only; a later pass should confirm / quantify:

- **L2 (visual)** — how the list skeleton reads vs the onboarding hero; whether a terminal-state
  task's detail (run-control `null`, gap ⑪) leaves an obvious next action; kanban at many
  columns; the artifacts total-hide (gap ⑪); narrow-width + dark-mode of the create modal.
- **L3 (dynamic)** —
  - Force the list fetch offline → **confirm gap ① live** (permanent skeleton, no retry).
  - Force the detail fetch to 500 → **confirm gap ②** (shows "Task not found", no reload).
  - Force a run start / pause / create to fail → **confirm gap ③** (button snaps back, no toast).
  - Force a schedule / verify save to fail → **confirm gap ④** (value reverts silently).
  - Seed 60+ tasks → **confirm gap ⑤** (only 50 render, sort/group over the partial set).
  - **Measure list CLS/LCP** across skeleton→content and the 50 per-row detail fetches (gap ⑤).
