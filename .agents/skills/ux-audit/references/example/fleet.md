# Worked example — Fleet view (`/fleet`) audit

A real run of this skill against the **Fleet view** ("Observation Mode"), 2026-07 — a
side-by-side, drag-reorderable **column board of running agent tasks**: a left running-task
sidebar portaled into the global NavPanel + a horizontally-scrolling board where each running
topic is an independently-scrollable, resizable conversation column, auto-populated from a
live poll of the account's running topics. Use it as a template for the output shape, not as
current-state truth (the code moves; re-verify before citing).

**Surface class:** live multi-column dashboard — benchmark against **TweetDeck / column
dashboards**, CI run boards (GitHub Actions), and Kanban boards (Trello). Class norms: each
column + the board have empty/loading/**error** states; a live feed **signals new items** and
offers **manual refresh**; add / remove / reorder / persist columns; a "keep this column"
marker actually protects it.
**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic + CLS)
⏳ not yet run — see §5. Verdicts about the render are L1 inferences here, pending L2.

**Load-bearing files:** `routes/(main)/fleet/index.tsx`, `features/Fleet/{index, ColumnsBoard,
AgentColumn, RunningTaskSidebar, AddColumnButton, RowsSwitcher, FleetPanelCollapseSync}.tsx`,
`features/Fleet/{store, useRunningTopics, idleColumns, runningStatus, types}.ts`,
`libs/swr/index.ts` (`useClientDataSWR` — non-suspense).

## 1 — Patterns in use

| Pattern (family)                     | Where                                                            | Rating | Note                                              |
| ------------------------------------ | ---------------------------------------------------------------- | ------ | ------------------------------------------------- |
| Movable Panels / Card Stack (layout) | `ColumnsBoard` dnd-kit columns + bands (`ColumnsBoard.tsx`)      | ✅     | reorder + cross-band drag, drag overlay preview   |
| Overview + Detail (data)             | sidebar running list → board column (`RunningTaskSidebar`)       | ✅     | click an item opens/focuses its column            |
| Deep-linking (nav)                   | `/fleet`, `/:workspaceSlug/fleet`                                | ✅     | route restores the board (columns from persist)   |
| Movable Panels persistence (layout)  | `store.ts` `persist` (columns/widths/rows/pins)                  | ✅     | layout survives reload — highlight                |
| News/Activity Stream (data)          | `useRunningTopics` focus-poll (`focusThrottleInterval: 1000`)    | ⚠️     | **no new-item signal, no manual refresh** (gap ④) |
| Loading Skeleton (feedback)          | `SidebarTaskSkeleton` (mirrors the row), page `BrandTextLoading` | ✅     | skeleton reuses row chrome — good                 |
| **Failure + Retry (feedback)**       | running-topics poll                                              | — abs. | `error` dropped entirely — the dominant gap (①)   |
| Empty state — board (data)           | `ColumnsBoard.tsx:151-163` (Layers icon + title + desc)          | ⚠️     | real text, **CTA is a bare 52px "+"** (gap ⑤)     |
| Empty state — sidebar (data)         | `RunningTaskSidebar.tsx:284` `fleet.noRunningTasks`              | ⚠️     | plain text; **doubles as the failure state** (①)  |
| Selection-into-view (data)           | `handleActivate` / `AddColumnButton` double-rAF `scrollIntoView` | ✅     | new/focused column scrolls in — §1.3 done right   |
| Cancelability / Progress (feedback)  | `RunningStatus` live elapsed clock + ring; `StatusDot`           | ✅     | per-task elapsed time — highlight                 |
| Smart Menu Items (commands)          | `CloseIdleColumnsButton` disabled/counted by idle set            | ⚠️     | **ignores pins; unsafe on error** (gaps ②③)       |
| Pin / keep marker (commands)         | `AgentColumn` pin `ActionIcon` + `pinnedKeys`                    | ⚠️     | **purely cosmetic — protects nothing** (gap ③)    |

**Read:** the board's **layout/persistence/drag** machinery and **per-task progress** (live
elapsed clock, scroll-into-view) are mature and a highlight. The weakness clusters exactly
where every audit so far has hit — **Feedback (the poll can't fail)** and **Read (a failed /
unloaded live feed masquerading as "empty/idle")** — and here that soft spot feeds a
**destructive** bulk action, which is what makes ① + ② a trust break rather than cosmetic.

## 2 — Strengths / good cases (don't regress)

The board is strong where it counts — these are the ✅ half of the 回灌 loop and the "don't
regress" list for the next refactor. Two are strong enough to land as **✅ examples in the `ux`
checklists** (see §4):

- **✅ 亮点 — Layout /persistence/drag.** dnd-kit reorder + cross-band drag with a portaled
  drag-overlay preview (so the moving card escapes each band's `overflow` clipping),
  `ColumnsBoard.tsx` + `ColumnDragPreview`, over a `persist` store that survives reload —
  columns / widths / rows / pins (`store.ts` `partialize`). Movable-Panels done to spec.
- **✅ 亮点 — Per-task live progress.** `RunningStatus`'s live elapsed clock + ring
  (`RunningTaskSidebar.tsx:47-107`) reads the runtime's real visible-start time and even hides
  the spinner in the `visible_output_end` tail (`runningStatus.ts`), so each column honestly
  shows how long its run has worked rather than a static "running" label.
- **✅ 亮点 — Selection-into-view done right (→ landed as ux Read §1.3 ✅).** `handleActivate` /
  `AddColumnButton` scroll a (re-)opened / newly-added column into the horizontal band via a
  **double-`requestAnimationFrame`** `scrollIntoView({ block: 'nearest', inline: 'end' })`,
  mirrored across **both** entry points so neither can regress alone.
- **✅ 亮点 — Skeleton reuses row chrome (→ landed as ux Feedback §4.1 ✅).**
  `SidebarTaskSkeleton` mirrors `SidebarTaskItem` exactly (28 px square avatar + two text lines
  at 70 % / 45 % width, same padding), an in-place load→content swap with no relayout.
- **Reply area's loaded-state gating.** `ReplyArea` reads the conversation's _real_ loaded state
  (`messagesInit`) rather than the raw `dbMessagesMap` (where `undefined` = "still loading"), so
  the reply affordance never blanks out mid-load — a stable "回复" placeholder holds the slot
  (`AgentColumn.tsx:255-292`). A quiet correctness win worth keeping.

## 3 — Experience gaps (ranked)

**① Running-topics poll swallows `error` → false "no running tasks" + every status collapses to idle + no retry — Read §1.1 / §1.7, Feedback §4.2** 🔴
`useRunningTopics` destructures only `{ data, isLoading }` and drops `error`
(`useRunningTopics.ts:36`); `isInit: !isLoading` (`:61`). `useClientDataSWR` is **not** suspense
(`libs/swr/index.ts:22-52`), so a poll error is never thrown to the route `<ErrorBoundary>` and
never represented. On error SWR sets `error` + flips `isLoading` false → `isInit` becomes
**true** with `data === undefined` → `columns = []`, `statusByColumnKey = {}`. Consequences:

- **Sidebar** renders `fleet.noRunningTasks` (`RunningTaskSidebar.tsx:281-284`, since
  `isLoading = !isInit = false`) — a **failed poll is indistinguishable from "no running
  tasks"**, the `data ?? [] → empty` trap on the read side of a live feed (§1.7: a failed
  refresh must never look like "no new items").
- **Board** keeps its persisted columns but every `StatusDot` / elapsed clock reads the empty
  `statusByColumnKey` → all columns silently **collapse to idle**; the live error is invisible
  on the board entirely.
- **No retry** anywhere. Fix: read `error`; drive a distinct failed state (sidebar + board
  banner) with a **Reload** that re-runs the SWR `mutate`; keep `isInit` gated so
  "errored/unknown" ≠ "loaded-empty".

**② "Close idle columns" becomes a one-click board-wiper on poll error — Act §3.4 / Feedback §4.2 (blast radius of ①)** 🟠
`getIdleColumnKeys` marks every column whose `statusByColumnKey[key] !== 'running'` as idle
(`idleColumns.ts:18`). It gates on `isStatusLoading` — but that's wired to `isLoading = !isInit`
(`RunningTaskSidebar.tsx:266-268`), which is **false on error** (see ①). So when the poll fails
the status map is `{}`, nothing loads as running, and **every open column reads as idle** — the
button lights up "close N idle columns" and one click removes the whole board
(`removeColumns(idleKeys)`, `:208`). A destructive bulk action must treat "unknown/errored"
status as _not eligible_, not as _idle_: gate on the query's real error/loading, never on a
success-only init flag.

**③ Pin is decorative — it protects nothing, and "close idle" overrides it — Act §3.4** 🟠
`pinnedKeys` is only toggled (`togglePin`) and filtered out on removal; **no code path gates on
it** — `syncRunningColumns` is append-only (never auto-removes) and `getIdleColumnKeys` never
consults pins. So the pin `ActionIcon` (`AgentColumn.tsx:422-428`, titled _"pin / keep this
column"_) merely highlights an icon: a **"keep this" affordance that keeps nothing**, and worse,
"close idle" (gap ②) will happily close a **pinned-but-idle** column — directly contradicting the
store's own comment that a pin is "a deliberate 'keep this column' marker" (`store.ts:47`). Fix:
either honor the pin (exclude `pinnedKeys` from `getIdleColumnKeys` / any future auto-cleanup) or
remove the affordance; a protective marker must be honored by **every** removal path.

**④ Live board has no new-item signal and no manual refresh — Read §1.7** 🟡
The board is an explicit polling feed (`focusThrottleInterval: 1000`, refetch on focus) and
`syncRunningColumns` **silently auto-appends** each newly-running topic as a column to the
least-full band (`store.ts:176-201`) — often off the right edge of the horizontal scroll. There's
no _"N new"_ indicator that a column appeared beyond the fold, and no manual **refresh** control
(the user is hostage to focus + the 1 s throttle). Class norm for a TweetDeck-style board; L1 can
name it, L2 confirms how invisible the off-screen append reads.

**⑤ Board empty state has value-prop text but no clear CTA button — Read §1.1** 🟡 (pending L2)
The board empty renders an icon + `fleet.empty` + `fleet.emptyDesc`
(`ColumnsBoard.tsx:151-163`) — real explanation — but the only add affordance is the bare 52 px
`AddColumnButton` "+" strip beside it (`AddColumnButton.tsx:85-90`), not a labeled "Add a column /
Create task" CTA in the empty region. Whether the "+" reads as _the_ next action is an **L2**
verdict — confirm on the render.

## 4 — Skill feedback

The 回灌 loop has two halves — a gap sharpens a checklist item's ❌ example, a good case sharpens
its ✅ one. Both landed from this run:

- **New ❌ rules landed** from this audit:
  - Read **§1.7** — new rule + Fleet ❌: a control **derived from a live-status map** (a "close
    idle" / "clear inactive") must gate on that query's **loaded/error** state — an errored or
    still-loading map reads every row as inactive, turning the bulk action into a wiper; treat
    "unknown" as ineligible, never as the inactive value (gaps ①②).
  - Act **§3.4** — new rule + Fleet ❌: a **protective marker** (pin / keep / lock) must be
    honored by _every_ removal path (bulk close, auto-cleanup); a decorative pin a "close idle"
    ignores is a broken promise (gap ③).
  - Each mirrored into the SKILL.md Quick review.
- **New ✅ good cases — each _refined the rule_, not just decorated it** (the good half of 回灌
  — see §2). A good case is only worth landing if it teaches the rule a distinction it didn't
  state:
  - Read **§1.3** — Fleet's scroll-into-view extracted **two** new sub-rules the rule was
    missing: (a) the re-run trigger has **two flavors** — async-arriving rows (key off row
    count) vs. a row **added imperatively in the same handler** (defer to the paint via
    rAF / double-rAF, since a synchronous `scrollIntoView` fires before React commits the
    node); and (b) the scroll **axis follows the list direction** — `inline: 'nearest'/'end'`
    for a horizontal band, not just `block`. Both folded into the prose + checklist; Fleet is
    the ✅ example.
  - Feedback **§4.1** — Fleet's `SidebarTaskSkeleton` extracted "match the real text's **width
    proportion**, not just its height" (long title line over a shorter subtitle, not two equal
    bars) — the rule previously said only "height ≈ real". §4.1 also had **no** ✅ example before.
- **Validated existing rules** (fresh ❌ examples to cite): Read §1.1 error-before-empty /
  false-empty (gap ①, sidebar), §1.7 failed-refresh-shown-as-empty (gap ①), Feedback §4.2
  init-flag-not-gated-on-success (`isInit: !isLoading`, gap ①), Read §1.1 empty-needs-CTA
  (gap ⑤).

## 5 — Pending: L2 visual + L3 dynamic

L1-only; a later pass should confirm / quantify:

- **L2 (visual)** — how the board empty (gap ⑤) reads (is the "+" the obvious CTA, or dead
  space?); whether a poll-error collapse (gap ①) is visibly distinguishable from a genuine idle
  board; the collapsed-status board vs a real running board; narrow-width + dark-mode of columns.
- **L3 (dynamic)** —
  - Force the running-topics poll offline to **confirm gap ①** live (sidebar shows "no running
    tasks", board statuses go idle, no retry) and **gap ②** (does "close idle" then light up and
    wipe the board?).
  - Pin a column, let its task go idle, click "close idle" → **confirm gap ③** (pinned column is
    closed).
  - Start a new task while scrolled left → **confirm gap ④** (a column appears off-screen with no
    signal).
  - **Measure CLS/LCP** across the skeleton→columns swap and a live column auto-append.
