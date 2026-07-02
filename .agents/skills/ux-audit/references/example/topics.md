# Worked example — Agent topics / 话题列表 (topic management) audit

A real run of this skill against the per-agent topic-management page
(`/agent/:aid/topics` → `src/features/AgentTopicManager`), 2026-07-02 (LOBE-11217, under the
Chat / 会话 UX-Audit parent LOBE-11145). Use it as a **template for the output shape**, not as
current-state truth (the code moves; re-verify before citing).

Surface = a scrolling management view over one agent's topics: **chrome** = `NavHeader` +
`AgentBreadcrumb` + a header **search box** (`Header.tsx`) → **① Toolbar** (status tabs with
count badges · trigger/project/time filter chips · card/list view toggle · sort · overflow
"archive stale") → **② BulkActionBar** (floating, appears on selection: favorite · archive ·
move · delete) → **③ the list** in card (`TopicGrid` → `TopicCard`) or list (`TopicListView`
→ `Row`) form, grouped by time/project, **infinite-scrolled** 30 rows/page → **④
MoveTopicsModal** (pick → confirm → moving → done). A topic row/card navigates to the chat
topic view.

**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic + CLS)
⏳ not yet run — see §5. Verdicts about the render (does the false-empty actually read as
onboarding, how the floating bulk bar sits) are L1 inferences here, pending L2.

**Surface class & its norms (benchmark first).** This is a **list-management console** —
the reference class is Gmail / Linear / Notion database views / a file manager: a large
collection the user filters, sorts, multi-selects, and bulk-operates. Class norms an L1
code-read should check present/missing: server-backed **filter + sort + search over the whole
set** (not the loaded page) ⚠️ (search only); **select-all across the filtered set**, not just
the visible page ✗; **bulk action → confirm → progress → partial-failure report** ⚠️
(delete/move only); a real **empty vs no-match vs failed** split ⚠️ (no failed); **row → detail
/ open** ✅. The defining risk of this class is the **partial-page lie** — anything computed
client-side over the lazily-loaded rows (filter, sort, counts, bulk scope) silently
misrepresents the full set.

## 1 — Patterns in use

| Pattern (family)                     | Where                                                                                   | Rating | Note                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| Visual Framework (layout)            | `NavHeader` + centered `maxWidth:1440` column (`index.tsx:201,213`)                     | ✅     | consistent chrome                                                               |
| Card Stack / Grid of Equals (layout) | `TopicGrid` auto-fill card grid (`TopicGrid.tsx:14`) + `TopicListView` table (`:264`)   | ✅     | two view modes, toggle in Toolbar                                               |
| Titled Sections (layout)             | time/project group bars (`TopicListView.tsx:281`, `TopicGrid.tsx:54`)                   | ✅     | grouping is a composition move, not a filter                                    |
| Dynamic Queries (data)               | status tabs + trigger/project/time chips + sort (`Toolbar.tsx`)                         | ⚠️     | **all client-side over the loaded page** (gap ②)                                |
| Search / find (data)                 | header `Input` → `useSearchTopics` BM25 (`index.tsx:86`, `Header.tsx:27`)               | ✅     | **server-side**, disables infinite-scroll in search mode (highlight)            |
| Row → Detail (nav)                   | card/row `navigate(AGENT_CHAT_TOPIC_URL)` (`TopicCard.tsx:98`, `TopicListView.tsx:162`) | ✅     | closed loop back into chat (Grow §5.3)                                          |
| Multi-select + Bulk (act)            | checkbox select + floating `BulkActionBar`; ⌘/ctrl-click to select (`TopicCard.tsx:93`) | ⚠️     | select-all only in list view (gap ⑤); no locked/partial-failure (gaps ⑤⑦)       |
| Wizard / state machine (act)         | `MoveTopicsModal` pick→confirm→moving→done (`MoveTopicsModal/Content.tsx`)              | ✅     | textbook — lock dismissal, catch→retry, go-to-target CTA (highlight §2)         |
| Infinite scroll (data)               | `IntersectionObserver` sentinel → `loadMoreAgentTopicsView` (`index.tsx:180`)           | ⚠️     | page-fetch failure is silent (gap ④)                                            |
| Empty-state variants (feedback)      | filtered vs first-run split (`EmptyState.tsx:32`)                                       | ⚠️     | two of three states — **no failed variant** (gap ①)                             |
| Failure + Retry (feedback)           | —                                                                                       | —      | **absent** — initial fetch reads only `isLoading` (gap ①), load-more silent (④) |

**Read:** layout, the two view modes, grouping, server-side search, and the move modal are
mature. The weakness clusters in the **data-query layer** (everything but search is a
client-side pass over a partial page — gap ②/③) and in **failure handling** (no error state
on either the initial load or the page loads — gaps ①/④).

## 2 — Strengths / good cases (don't regress)

- \*\*✅ 亮点 — `MoveTopicsModal` is a textbook async-action state machine (→ ✅ for ux Act §3.1
  - Feedback §4.2).\*\* `pick → confirm → moving → done` (`Content.tsx:59,124,171,185,195`):
    it **locks dismissal mid-flight** (`setCanDismissByClickOutside(false)`, `:110`), the
    `catch` **toasts and returns to `confirm`** so the move is retryable without losing the
    picked target (`:115-118`), `moving` uses `NeuralNetworkLoading` (not antd `Spin`), and
    `done` offers a **"go to target agent" primary CTA** (`:203-213`) — forward momentum + a
    closed loop. This is the confirm→in-progress(locked)→done/error shape the bulk bar (gap ⑤)
    lacks; it's the "don't regress" reference for every other mutating path on this surface.
- **✅ 亮点 — Move picker re-adds the virtual inbox agent (already landed as ux Read §1.4 ✅).**
  `targetAgents` prepends the inbox/default "LobeAI" agent that the sidebar list filters out
  (`Content.tsx:80-98`), so topics can be moved to it — a picker that lists every valid
  target, not "every target the sidebar happened to keep".
- **✅ 亮点 — Server-side BM25 search + infinite-scroll disabled in search mode.** Search
  routes to `useSearchTopics` → `searchTopics` over the whole set (`index.tsx:86`,
  `action.ts:779`), and the observer effect early-returns in search mode
  (`index.tsx:181,248`) so paging doesn't fight relevance order. This is the **one** read
  dimension done right — and exactly what makes gap ② (the other four dimensions,
  client-side) legible as the anomaly rather than the norm.
- **✅ 亮点 — Reset-on-agent-switch guards stale bulk targets.** The route reuses one
  component instance across `/agent/:aid` navigations, so `reset()` runs on `activeAgentId`
  change, not just unmount (`index.tsx:72-74` + comment). Without it a leftover `selectedIds`
  from agent A would make a bulk Delete/Archive on agent B **silently target another agent's
  topics** — a real data-safety guard.
- **✅ 亮点 — Dedicated SWR bucket for the management view.** The heavy `withDetails` fetch
  lives in its own `agentTopicsViewMap` bucket, not the sidebar's cheap one (`index.tsx:37-41`
  - comment), so the two responses can't clobber each other on whoever-lands-last.
- **✅ good — `preStatusPool` counts each tab "as if you switched with the same other
  filters".** The status count badges are derived from the pool with every filter _except_
  status applied (`index.tsx:99-126`), so switching tabs is predictable. Thoughtful
  composition — undermined only by the partial-page problem (gap ②), not by its own logic.

## 3 — Experience gaps (ranked)

**① A failed initial fetch renders as the first-run "no topics yet" onboarding — ux Read §1.1
/ Feedback §4.2** 🔴 `useFetchAgentTopicsView` returns a full `SWRResponse` (it has `.error`),
but the page destructures only `{ isLoading }` (`index.tsx:76`) — **`error` is never read**.
The view map is populated **only in the SWR `onData`** success path (`action.ts:570-621`), so
on any network / 500 / auth failure `agentTopicsViewMap[key]` stays undefined →
`allTopics = []` → `totalAfterFilter === 0` → the page renders
`<EmptyState hasFilters={false}>` = **"No topics yet — start a chat"** (`index.tsx:225-230`,
`EmptyState.tsx:35`). A failure masquerades as **onboarding**: no reason, no Reload, and it
invites the user to re-create conversations they already own. Remedy: read `error`; branch a
failed state (reason + `mutate` retry) **before** the empty branch — only show empty on
`!error && total === 0`.

**② Filters, sort, and the count badges all run client-side over the loaded page, not the
server — ux Read §1.2 / memory `feedback_paginated_list_sort_server_side`** 🟠 The list is
infinite-scrolled 30 rows/page (`index.tsx:32`, `action.ts:627`), but **every read dimension
except search** is computed client-side over `allTopics` (the loaded pages only):
`matchesStatus / matchesGroup / matchesTrigger / matchesTimeRange` + `sortTopics` + grouping
(`index.tsx:99-140`, `utils.ts:9-89`), and the per-status **count badges** (`index.tsx:115-126`
→ `Toolbar.tsx:427`). The management fetch sends the server only `agentId / current / pageSize
/ withDetails` (`action.ts:562-567`) — **no** status/trigger/time/sort. Consequences on any
agent with >30 topics not fully scrolled in:

- **Sort is a lie across pages** — sorting by title/created orders just the loaded rows;
  scrolling appends the next `updatedAt`-ordered page at the **end**, so the list visibly
  isn't sorted.
- **A filter can show a false "no match"** — filtering to `completed` / a rare trigger shows
  `EmptyState hasFilters` "no topics match" while matching topics sit on unfetched pages.
- **The tab count badges under-report** — "Completed 3" when 40 completed exist unloaded.

The kicker: the server **already supports** server-side status/trigger filtering — the
sidebar's `loadMoreTopics` passes `excludeStatuses` / `excludeTriggers` into the same
`getTopics` service (`action.ts:724-734`); the management view just omits them. Remedy: push
the active filter + sort into `getTopics` (cheapest), or lift the whole read-state to the URL

- fetch key per Read §1.2 (also buys deep-linking).

**③ "Archive stale >3mo" mutates only the loaded page and reports success even on partial
failure — ux Read §1.2 + Act §3.1** 🟠 The overflow "archive stale" scans
`topicSelectors.agentTopicsViewTopics` = **loaded topics only** (`Toolbar.tsx:349-355`, dup in
the unused `ToolbarActions.tsx:24-31`), so with 30 of 500 loaded it silently archives the
stale rows among 30 and **misses the rest** — a bulk op whose scope is the partial page (the
mutating twin of gap ②). And the loop `for (…) await updateTopicStatus(…)` has **no per-item
catch**; it then fires `message.success('archived N')` (`Toolbar.tsx:365-369`) even if a call
rejected mid-way — reporting a completion that didn't happen. Remedy: run the query for
"stale" server-side (or over the full set), wrap the loop to collect failures, and report
partial completion.

**④ A failed load-more page fails silently — no error, no retry, and the observer can
re-fire — ux Feedback §4.2** 🟠 `loadMoreAgentTopicsView`'s `catch` only resets
`isLoadingMore: false` — **no error state, no retry** (`action.ts:678-689`; identical in
`loadMoreTopics:765-776`). A failed page-N fetch makes the "Loading more…" row vanish
(`index.tsx:251`) and the list just **stops**, indistinguishable from end-of-list — while
`hasMore` is still `true`, so the `IntersectionObserver` (`index.tsx:185-193`) re-fires on any
scroll nudge, **silently retrying a failing endpoint** with zero feedback. Remedy: on a
page-fetch rejection set an error flag and render an inline "couldn't load more — Retry" row
at the tail, distinct from the genuine end.

**⑤ Batch favorite / archive are fire-and-forget: no locked state, no failure surface — ux
Act §3.1 / Feedback §4.2** 🟠 `handleBatchFavorite` / `handleBatchArchive` fan out
`Promise.all(...)` and call `exitSelectMode()` immediately, with **no in-progress lock and no
`catch`** (`BulkActionBar.tsx:56-68`). If a write fails the user gets no toast and the
selection is already gone; double-clicking re-fires. This is exactly the
confirm→**in-progress(locked)**→done/error shape the sibling `MoveTopicsModal` (§2) and the
`confirmModal`-driven batch **delete** (`:70-85`, whose async `onOk` locks the OK button) get
right — the two lighter bulk actions skip it. Remedy: lock the bar while the batch runs and
toast on failure, matching delete/move.

**⑥ The default (card) view is missing both per-item actions and select-all that the list
view has — ux Act (lifecycle completeness + bulk↔single parity) / Read §1.2** 🟡 The default
`viewMode` is `'card'` (`store.ts:52`), yet `TopicGrid` / `TopicCard` render **no per-item
dropdown** — rename, single-delete, favorite-toggle, and "open in new tab" all live only in
`TopicListView`'s `Row` via `useTopicItemDropdownMenu` (`TopicListView.tsx:148-153,231-233`).
So in the view the user lands on, a topic's own lifecycle is unreachable without switching to
list view. `TopicGrid` also has **no select-all** (only `TopicListView` renders the header
checkbox, `:267-273`), so bulk-select in card view means clicking every card. And even in list
view, `handleSelectAll` selects `allIds` = the **loaded** rows (`:249,255-262`), never "all N
matching across pages" (pairs with gap ②). Remedy: give the card view the same per-item menu +
select-all; when paginated, offer "select all N" the server resolves.

**⑦ Bulk delete aborts mid-loop on first failure with no partial-failure report — ux Act
(partial failure)** 🟡 Batch delete confirms (good — `confirmModal` with a danger button and
count, `BulkActionBar.tsx:70-84`) then loops `for (…) await removeTopic(id)` serially. A
mid-loop rejection **throws out of the loop**: the remaining selected topics stay,
`exitSelectMode()` never runs, and there's no toast — the user sees a partially-completed
delete with no report of what failed. (Deleting many topics is wide-blast; a count confirm is
acceptable, but silent partial completion isn't.) Remedy: collect per-item results and report
"deleted X, failed Y — retry".

**⑧ Minor — rename edit is discarded silently on click-outside — ux Edit §2.1** 🟡 Rename
(list-row menu only) opens the shared `RenameModal`, whose value is in-memory `useState` and
whose mask is `maskClosable` — a click outside discards the edit with no "discard changes?"
guard. A single-field title rename is low-stakes for durable draft persistence, but the
**silent** discard on an accidental outside-click is the real gap. Remedy: warn on dirty
dismiss (or disable `maskClosable` while dirty). Shared component, not topic-specific — noted,
not landed.

## 4 — Skill feedback (回灌)

- **New generalizable gap → landed in `ux` Read §1.2 (mandatory close).** §1.2 already said
  "search **and filter** must query the server", but every ❌/✅ example was about the **search
  box** alone. This surface reveals the sharper, **split-dimension** rule: getting search
  server-side is **not** the whole job — a facet **filter**, a **sort**, the **count badges**,
  and any **"act on the filtered set" bulk op** each _independently_ lie if held client-side
  over the loaded page (false-empty · mis-ordered-across-pages · under-counted · partial-scope
  mutation), even when search is correct. Landed by extending Read §1.2 (new paragraph + ❌
  **Agent topics** example + a checklist line) and mirroring one line into the SKILL Quick
  review, citing `AgentTopicManager/index.tsx:99-140` + `Toolbar.tsx:349`.
- **New generalizable gap → landed in `ux` Feedback §4.2.** All existing §4.2 examples were
  **initial-load** skeletons that hang; none covered the **load-more / infinite-scroll** page
  failure, which fails _differently_ — the first page looks healthy, the next-page `catch`
  silently drops the "loading more" row with `hasMore` still true, and an `IntersectionObserver`
  re-fires into a silent retry loop. Landed as a new §4.2 paragraph + checklist line + a
  Quick-review mirror, with **Agent topics** as the ❌ (both the initial-fetch masquerade of
  gap ① and the load-more silence of gap ④), citing `index.tsx:76` + `action.ts:678-689`.
- **Validated existing rules** (good ❌ instances to cite): Read §1.1 (gap ①, error-as-empty
  masquerade), Feedback §4.2 (gaps ①④, no retry), Act §3.1 (gap ⑤, bulk with no
  locked/error state; gap ⑦, no partial-failure report).
- **Good cases already landed / reinforced ✅:** Read §1.4 (the move picker's inbox re-add is
  already the §1.4 ✅); the `MoveTopicsModal` state machine (§2) reinforces Act §3.1's
  confirm→in-progress→done/error ✅ and is worth citing as the in-context counter-example to
  the fire-and-forget bulk bar.

## 5 — Pending: L2 visual + L3 dynamic

L1-only; verdicts a later pass should confirm or quantify on this surface:

- **L2 (visual)** — does the failed-fetch empty (gap ①) actually **read** as first-run
  onboarding (confirm the masquerade)? Where does the floating `BulkActionBar` sit relative to
  the last row / does it occlude content? Card vs list select-all asymmetry (gap ⑥) side by
  side; narrow-width wrap of the Toolbar chips (`Toolbar.tsx:421 wrap`); dark/light on the
  status dots + group bars.
- **L3 (dynamic)** —
  - Force the topics fetch offline to **confirm gap ① live** — that the page settles on the
    "start a chat" empty, not a skeleton or error.
  - On an agent with **>30 topics**, filter to a status whose matches are all on page 2+ to
    **confirm gap ②'s false-empty**, and sort by title then scroll to watch order break across
    the page boundary.
  - Fail a page-2 fetch to **confirm gap ④** (the vanished "loading more" + observer re-fire).
  - Drive a bulk favorite/archive with one write forced to fail to **confirm gap ⑤** (no
    toast, selection already cleared).
  - **Measure CLS** on the card→list toggle and on the load-more append.
