# Worked example — Tasks list /kanban (任务列表) audit

A real run of this skill against the **agent tasks list** — the cross-agent list/kanban board
(`/tasks`) and its agent-scoped twin (`/agent/:aid/tasks`), 2026-07 (LOBE-11219). Use it as a
template for the output shape, not as current-state truth (the code moves; re-verify before
citing).

> **One pair of surfaces, audited as two focused reports.** The tasks list and the single-task
> **detail** (`/task/:taskId`) share one store and one feature package but are **different
> surfaces** with different class norms, so they get one report each: this file (the list) and
> its sibling [`task-detail.md`](task-detail.md) (the detail / run-monitor). They were first
> audited together; the combined run's `ux` 回灌 is already landed (§4). The **cross-surface
> seam** between them (list `tasks` array vs detail `taskDetailMap`) is a real gap — owned here
> as **gap L③**, cross-referenced from the detail report.

**Both route trees delegate to one component.** The Chat-side `agent/:aid/tasks`
(`desktopRouter.config.tsx:121-128`) and the standalone `/tasks` (`:643`) both render
`AgentTasksPage` parameterized by `agentId` / all-agents (`routes/(main)/agent/tasks/index.tsx`,
`routes/(main)/tasks/index.tsx:3`). One list surface, audited once.

**Surface class:** agent task board / issue-tracker list — benchmark against Linear / Asana /
GitHub Issues (list · kanban · grouping · priority · assignee · **live status** · bulk ops).
**Layers run:** L1 (static / code) ✅ — §1–§4 below. L2 (visual) ✅ — a **re-verify pass on a later
branch** (user-supplied screenshot of the populated list), see the **§6 addendum**. L3 (dynamic + CLS)
⏳ not yet run — see §5.

**Load-bearing files:** `features/AgentTasks/AgentTaskList/{AgentTasksPage,TaskList,KanbanBoard,
KanbanColumn,EmptyState,CreateTaskInlineEntry}`, `features/AgentTasks/features/AgentTaskItem.tsx`,
`features/AgentTasks/hooks/useTaskItemContextMenu.tsx`, `CreateTaskModal/*`,
`store/task/slices/{list,detail,lifecycle}/action.ts`, `store/task/selectors/listSelectors.ts`,
`apps/server/src/routers/lambda/task.ts`.

## 1 — Patterns in use

| Pattern (family)                   | Where                                                                      | Rating | Note                                                   |
| ---------------------------------- | -------------------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| Overview + Detail (nav)            | row → `taskDetailPath` (`AgentTaskItem.tsx:65-72`)                         | ✅     | click row / subtask opens detail                       |
| Deep-linking / breadcrumb (nav)    | copy-link builds absolute workspace URL (`useTaskItemContextMenu.tsx:142`) | ✅     |                                                        |
| List ⇄ Kanban toggle (nav)         | `TasksGroupConfig.tsx`, persisted `viewMode`                               | ✅     | view choice sticks                                     |
| Grouping / sub-group / sort (data) | `TaskList.tsx:135-201`, `listViewOptions`                                  | ⚠️     | rich — but **client-side over a ≤50 cap** (gap L②)     |
| Empty-as-onboarding (growth)       | `EmptyState.tsx:36-99` (greeting + inline create + templates)              | ✅     | strong first-run hero — **亮点** (§2)                  |
| Permission-gated actions (act)     | create/edit gated on `usePermission` + tooltip reason                      | ✅     | `AgentTasksPage.tsx:60,125` — **亮点** (§2)            |
| Hidden-completed footer (data)     | "N completed hidden · show" (`TaskList.tsx:224-243`)                       | ✅     | reversible disclosure                                  |
| Loading Skeleton (feedback)        | list `TaskList.tsx:203-213`, kanban `KanbanBoard.tsx:203`                  | ⚠️     | gated `!isInit` → **permanent on error** (gap L①)      |
| **Failure + Retry (feedback)**     | list / group fetch                                                         | — abs. | the surface's dominant gap (L①)                        |
| Empty state variants (data)        | generic `Empty` (`TaskList.tsx:216-222`)                                   | ⚠️     | **no CTA, no no-match variant** (gap L⑥)               |
| Live / status feed (data)          | per-row `useFetchTaskDetail` polls in-flight rows only                     | ⚠️     | list-level status **not** refreshed; no indicator (L⑥) |
| Optimistic mutation (act)          | kanban drag / context-menu status / inline create                          | ⚠️     | **most swallow failure** (gaps L③L④)                   |
| Lists at scale (data)              | plain `.map`, no windowing (`TaskList.tsx:43-48`)                          | — abs. | no virtualization / pagination (gap L②)                |
| Inline create + modal (act/edit)   | `CreateTaskInlineEntry.tsx`, `CreateTaskModal/*`                           | ⚠️     | **draft not persisted** (gap L⑤)                       |

**Read:** navigation, view-toggle, first-run onboarding and permission-gating are mature. The
weakness clusters in **Feedback / Read-at-scale**: no error path (L①), no virtualization over a
silent 50-row cap (L②), a stale-across-surface list row (L③), several silent-failure write paths
(L④), an unprotected create draft (L⑤), and a quasi-live list that under-serves liveness while
its empty state dead-ends (L⑥).

## 2 — Strengths / good cases (don't regress)

The read/onboarding spine is strong — these are the ✅ half of the 回灌 loop and the "don't
regress" list for the (mostly write-path) next refactor:

- **✅ 亮点 — Empty-as-onboarding hero.** First-run empty isn't a blank slate: `EmptyState.tsx:36-99`
  renders a greeting, an inline create composer, and recommended task templates (with their own
  skeletons + refresh), gated on `isListEmpty` (`AgentTasksPage.tsx:64,146`). The empty state
  doubles as the primary entry point — the model an empty data list should follow.
- **✅ 亮点 — Permission-gated actions carry their reason.** Create / edit are gated on
  `usePermission('create_content')` with a tooltip `reason` wired consistently across the header
  `+`, the inline composer submit, the context menu, and run-all (`AgentTasksPage.tsx:60,125`,
  `CreateTaskInlineEntry.tsx:285`) — a disabled control that says _why_, not a dead one.
- **✅ 亮点 — Reactive per-row polling.** Each row's `useFetchTaskDetail` polls 10 s **only while**
  that task has in-flight activity (`store/task/slices/detail/action.ts:300-315`, reactive
  `shouldPoll` boolean → `refreshInterval`), dodging SWR's function-form cold-start trap. (Caveat:
  it refreshes the row's _detail_, not the list's own status field — see gap L⑥.)
- **✅ — Hidden-completed footer.** Completed tasks collapse behind a "N hidden · show" footer
  (`TaskList.tsx:224-243`) rather than padding the list — reversible progressive disclosure.

## 3 — Experience gaps (ranked)

**L① List / kanban fetch failure → permanent skeleton, no retry — Feedback §4.2** 🔴
`isTaskListInit` / `isTaskGroupListInit` flip `true` **only** in the SWR `onSuccess`
(`store/task/slices/list/action.ts:146-155`, `:110-116`); there is **no `onError`** anywhere in
`src/store/task`, and the hook's `error` / `isLoading` are **discarded at the call site** —
`AgentTasksPage.tsx:62-63` calls `useFetchTaskList(...)` without assigning the return (kanban:
`KanbanBoard.tsx:89-90`). `TaskList.tsx:203` renders the skeleton on `!isInit`. So once
`taskService.list()` exhausts SWR's retries, `isInit` stays `false` **forever** → skeleton spins
with no error, no retry. And error is never checked before empty: `isListEmpty = isTaskListInit &&
tasks.length === 0` (`listSelectors.ts:41`) is `false` on failure, so the page falls through the
onboarding hero into the permanent skeleton — a failed load reads as neither empty nor error.
_Remedy:_ add `onError` → an error state + Reload; read the hook's `error` at the call site.

**L② List sort / group / filter run client-side over a 50-row cap; no virtualization — Read §1.2** 🟠
The server caps the list at `limit` default **50** (`apps/server/src/routers/lambda/task.ts`), and
`fetchTaskList` passes no limit/offset, so 50 rows load while `tasksTotal` can be larger.
`TaskList.tsx:135-201` then filters, sorts, and groups **entirely in-memory over those 50** — no
pagination, no load-more, no windowing (plain `.map`, `TaskList.tsx:43-48`; kanban maps all,
`KanbanColumn.tsx:260`). A user with 60 tasks sees 50, and any sort/group silently orders a partial
set (the paginated-sort-client-side trap). Each visible row _also_ mounts its own
`useFetchTaskDetail(task.identifier)` (`AgentTaskItem.tsx:48`) → up to 50 detail SWR subscriptions
per list paint. _Remedy:_ server-side sort/group/paginate (URL-driven keys), virtualize, batch the
per-row detail.

**L③ Detail edits don't propagate to the list — two un-normalized caches — Act §3.1 (cross-surface)** 🟠
The list reads a `tasks` array (`useFetchTaskList` `onSuccess`); the detail reads `taskDetailMap`.
`updateTask` patches only the map and refreshes the list **only** when assignee / parent changed
(`store/task/slices/detail/action.ts:295-297`). So editing a task's **title / priority / model /
instruction** from the detail leaves the **list row stale** — visible when list + detail are
mounted together (Chat portal) or on cached back-navigation (`revalidateOnFocus:false`). This is a
seam **between** this surface and [`task-detail.md`](task-detail.md); a per-surface read misses it
by construction (see the method note in §4). _Remedy:_ one normalized map, or invalidate the list
on every successful write, not a gated subset.

**L④ Context-menu / drag / create write failures are silent — Act §3.1** 🟡
The context menu fires `void updateTaskStatus(...)` (`useTaskItemContextMenu.tsx:114`, `:279`) —
`#transitionStatus` `console.error`s and rethrows (`lifecycle/action.ts:104-109`), but the `void`
drops it, so a failed status change silently reverts on the next refresh. Kanban `handleDragEnd`
awaits `updateTaskStatus` in `try { } catch { revert }` with an **empty catch**
(`KanbanBoard.tsx:137-141`) — reverts the card, no toast. `createTask` (`detail/action.ts:150-174`,
`try/finally` no catch) rejects up to `CreateTaskInlineEntry.handleSubmit` (`:107-155`), which
`await`s it with **no catch and no error toast** — a failed create leaves the composer unclear'd
with no word. All three should toast at the store-action boundary (the run-all flow and detail
`updateTask` already do — see §2 / task-detail.md).

**L⑤ Create draft not persisted — modal `maskClosable` discards typed content — Edit §2.1** 🟡
`CreateTaskContent` / `CreateTaskInlineEntry` hold the draft in local `useState`
(`CreateTaskContent.tsx:51`, `CreateTaskInlineEntry.tsx:64`); the modal is `maskClosable: true`
(`CreateTaskModal/index.tsx:11`), so a stray backdrop click discards everything typed with no
warning, and the minimize → inline handoff opens a fresh entry rather than carrying the draft.
(Twin of the home-composer in-memory-draft ❌ already in Edit §2.1.) _Remedy:_ back the draft to
localStorage keyed per agent, or warn on dirty close.

**L⑥ Quasi-live list under-serves liveness, and the empty state dead-ends — Read §1.7 / §1.1** 🟡
The list is a live surface (running tasks change status), but the row's top-level status tag reads
`toTaskStatus(task.status)` from the **non-polled list fetch** (`AgentTaskItem.tsx:62,101,166`);
the per-row detail poll refreshes subtasks/activities but never `refreshTaskList`, so a
running→completed transition can show a **stale top-level status** until a mutation or remount, and
there is **no Update Indicator / "N new" / manual refresh** anywhere. Separately, the generic
`Empty` (`TaskList.tsx:216-222`) is description + icon with **no CTA** and **no no-match variant**,
so a list filtered/grouped to zero rows (while `isListEmpty` is false) dead-ends with no
create/clear-filters affordance. _Remedy:_ refresh the list-level status on the same poll (or a
"N updated · refresh" pill), and give the zero-rows `Empty` a create / clear-filters CTA.
**(the visible staleness needs L3 to confirm — see §5.)**

## 4 — Skill feedback (回灌)

- **Already landed by the combined run (validated-existing here):** Feedback **§4.2** ❌ (gap L①,
  the `isTaskListInit`-only-on-success + error-discarded-at-call-site permanent skeleton); Read
  **§1.2** ❌ (gap L②, sort/group over a partial paginated page); Act **§3.1** cross-surface
  coherence rule + ❌ (gap L③, list `tasks` vs detail `taskDetailMap`); Act **§3.1** job-control /
  optimistic ❌ (gap L④); Edit **§2.1** in-memory draft (gap L⑤). Read **§1.7** live-feed ❌ and
  Read **§1.1** empty-variant (gap L⑥). All already cite this surface.
- **No new generalizable rule from this split run.** The two fresh angles (list-level status
  staleness while rows poll individually; the generic `Empty` with no CTA / no no-match) are both
  **instances of already-complete rules** (Read §1.7 live feed owes an indicator + refresh; Read
  §1.1 empty owes a CTA and a no-match variant), not a missing distinction — so, per the good-case
  rule, nothing is landed; they're recorded as ❌ examples.
- **Noted, not landed (candidate):** _a list whose **rows** are individually live (each polls its
  own detail) but whose **list** fetch is static — the row summary goes stale while its detail
  refreshes_. Per-row polling ≠ list freshness. Promote to a Read §1.7 sub-rule if a second surface
  repeats it.

> ⚠️ **Method note (carried from the combined run).** The cross-surface seam L③ was missed on the
> first per-surface pass because a list-only reader and a detail-only reader each ignored the
> other, so the shared-store seam was owned by neither. When a surface pair edits + lists the
> **same entity**, one reader must own the seam (the shared store) — this split keeps L③ owned
> here and cross-referenced from the detail report, not dropped between them.

## 5 — Pending: L2 visual + L3 dynamic

- **L2 (visual)** — how the list skeleton reads vs the onboarding hero; the zero-rows `Empty`
  (gap L⑥); kanban at many columns; narrow-width + dark-mode of the create modal.
- **L3 (dynamic)** —
  - Force the list fetch offline → **confirm gap L① live** (permanent skeleton, no retry, no empty).
  - Seed 60+ tasks → **confirm gap L②** (only 50 render; sort/group over the partial set).
  - Edit a task's title/priority from the detail with the list mounted → **confirm gap L③** (stale row).
  - Let a running task complete while the list is open → **confirm gap L⑥** (stale status, no indicator).
  - Fail a context-menu status change / kanban drag / create → **confirm gap L④** (silent revert).
  - **Measure list CLS/LCP** across skeleton→content and the up-to-50 per-row detail fetches (gap L②).

## 6 — L2 visual addendum (2026-07, later branch)

A **re-verify pass** on a later branch, anchored on a user-supplied screenshot of the **populated**
list (a persistent create composer holding a long draft, above a "进行中 1" status group with a single
cron task). Two things it establishes that the original L1-only run could not:

**First, the original 🔴 L① is fixed.** `TaskList` now wraps its content in `AsyncBoundary` with
`error` / `isLoading` / `onRetry`, and `AgentTasksPage.tsx:67-72` keeps the SWR handle and threads
`error`/`mutate` into it (`TaskList.tsx:300-316`), gating error **ahead of** empty. A failed list
fetch now shows Retry instead of a permanent skeleton — exactly the remedy L① asked for. **Don't
regress the call-site read.**

**Second, two gaps only the render exposes** (both landed as new `ux` rules — Read **§1.11** and
**§1.12**):

- **V1 🟠 — the persistent composer buries the list (Read §1.11, Center Stage).** `AgentTasksPage.tsx:165`
  renders `CreateTaskInlineEntry` whenever `!inlineCollapsed`, and its Lexical editor grows to content
  height with **no `max-height` / scroll** (`CreateTaskInlineEntry.tsx:213-231`). A long instruction draft
  fills \~half the viewport and pushes the "进行中" group + every task **below the fold** — on a populated
  board the composer out-weighs the records. _Remedy:_ cap the editor height; default to collapsed once
  `!isEmptyHero`.
- **V2 🟠 — a scheduled task is mislabeled "进行中 / In Progress" (Read §1.12, consistency-is-semantic).**
  `listViewOptions.ts:107` folds `scheduled → running` and the group header renders
  `taskDetail.status.running` (`:232,237`), so a daily-cron task idle until 06:00 sits under "In Progress"
  though its own row reads "每天 06:00 运行". The group label asserts a state the task isn't in. _Remedy:_
  a distinct "Scheduled" group ranked above running.
- **V3 🟡 — the latest-activity sub-line duplicates the task name.** `AgentTaskItem.tsx:209` →
  `TaskLatestActivity` renders " 主题 #5: <title>" (`TaskLatestActivity.tsx:13-24`); for a recurring task the
  topic title equals `task.name`, so the row prints the name twice. _Remedy:_ suppress the sub-line when it
  equals `task.name`, or show last-run time / result instead. (Instance of interface-details duplication —
  ❌ example, not a new rule.)

Still open from §3 at re-verify (unchanged): L② (client-side sort/group over the 50-cap + per-row detail
fan-out), L④ (silent create failure — `handleSubmit`'s `if (result)` has no error toast,
`CreateTaskInlineEntry.tsx:148-170`), L⑤ (create draft in local `useState`, not persisted), L⑥ (in-list
`Empty` has no CTA / no no-match variant; list-level status not refreshed by the per-row poll).
