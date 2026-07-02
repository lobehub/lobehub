# Read — viewing data & lists

Any surface that **displays** records, lists, or detail. Covers the states a data
view can be in, behavior at scale, keeping the user's place visible, picker
completeness, number formatting, and landing on the right view.

Part of the **ux** skill — see [`../SKILL.md`](../SKILL.md) for the design values,
interaction principles, and the DESIGN.md boundary. Each checklist item is tagged
with the design value(s) it serves.

## 1.1 Data states: empty / loading / error・Meaningful・Certainty

Every data surface has **four** states — design all of them, not just "has data".
Empty is a purpose-built page that explains what this is, why it's empty, and gives a
clear next action (CTA + value props); distinguish "no data yet" (onboarding CTA) from
"no match for filters" (clear-filters affordance) — they are different screens. When a
surface keeps its toolbar/header mounted with no data (so a create / `+` affordance
stays reachable), the **body** below must still render an empty placeholder —
persistent chrome is no excuse for dead space. Loading uses a skeleton /
`NeuralNetworkLoading`, never a flash of blank or a layout shift; error surfaces the
reason and a retry/back path.

The single most common way this breaks: the fetch reads only `{ data, isLoading }`, never
`error`, and coerces the failure into the empty branch — `const items = data ?? []` then
`if (!items.length) return <Empty/>`. A **failed** load then renders as "you have nothing",
inviting the user to re-create what they already own, with no reason and no retry. **Check
`error` _before_ the empty branch**: only show empty when `!error && length === 0`; a failure
gets its own state (reason + Reload). Error is not a kind of empty.

> ✅ An empty "Connect your first device" page with primary/secondary connect paths and "what you can do once connected" cards.
> ✅ The agent **Documents** tab keeps its new-folder / new-doc toolbar and renders an `Empty` below it when there are no documents.
> ❌ A bare title over skeleton rows, or a toolbar over dead space.
> ❌ `Devices` renders a failed device-list fetch as the "Connect your first device" onboarding empty (`DeviceManager.tsx` reads only `{data, isLoading}`), falsely telling the user they own no devices — the same `data ?? [] → empty` trap in `Messenger`, `Creds`, `Skill`, `Stats`, `SystemTools` (7 settings tabs at once); and in **Eval** overview, where a failed benchmark fetch renders the "create your first benchmark" onboarding empty (`eval/index.tsx`).
> ❌ A detail page that `return null`s until its record loads is **not** a loading state — it's a blank flash on the happy path and a **permanent blank** if the fetch fails (no skeleton, no error): **Eval** run / case / dataset detail all `if (!record) return null` (`eval/bench/[benchmarkId]/runs/[runId]/index.tsx`, `.../cases/[caseId]/index.tsx`, `.../datasets/[datasetId]/index.tsx`). Render a skeleton, then an error state.
> ❌ **Resource** repeats the failure-as-empty trap four times: the Explorer reads only `{ isLoading, isValidating }` (the swr already exposes `error`, unread) so a failed resource fetch renders the "create your first resource" onboarding (`ResourceManager/components/Explorer/index.tsx`, `EmptyPlaceholder.tsx`); the sidebar KB list (`resource/(home)/_layout/Body/LibraryList/index.tsx`), the search overlay (`SearchResultsOverlay.tsx` → false "no results"), and the folder tree (`LibraryHierarchy/index.tsx` → false "add folder") all do the same.

**Failure is also not "not found".** A detail page that coerces a fetch failure into a **404 /
"doesn't exist"** terminal is the same masquerade wearing a different mask: it tells the user the
record was **deleted** when the load merely **errored** (and a 404 is a dead-end — no Reload).
Distinguish `error` (transient → reason + retry, keep the URL) from a resolved not-found
(`!isLoading && !data && !error` → the real 404). Read `error` before falling to `NotFound`.

> ❌ **Resource** library detail: `const { data, isLoading } = useKnowledgeBaseItem(id)` then
> `if (!isLoading && !data) return <NotFound/>` (`resource/library/index.tsx`) — a network / 500
> on the KB fetch renders the permanent "this library doesn't exist" 404, so the user thinks it
> was deleted and gets no retry. ✅ Branch `error` to a reload state; keep 404 for a genuine miss.

**Checklist**

- [ ] Empty state is a real page with explanation + CTA, not a blank screen. _(Meaningful)_
- [ ] Empty variants distinguished: "no data yet" vs "no filter match". _(Certainty)_
- [ ] Error is checked **before** the empty branch — a failed fetch never renders as empty (`!error && length === 0` gates empty); read `error`, don't coerce `data ?? []`. _(Certainty・Meaningful)_
- [ ] A detail page reads `error` before falling to `NotFound` — a failed fetch shows a reload state, not a "doesn't exist" 404 (deleted vs failed-to-load are different screens). _(Certainty・Meaningful)_
- [ ] Always-rendered chrome still renders a body empty placeholder. _(Meaningful)_
- [ ] Loading designed (skeleton / NeuralNetworkLoading), no layout shift — a detail page's "record not loaded yet" is a skeleton, never a bare `return null` / blank. _(Natural)_
- [ ] Error designed with reason + retry/back path. _(Meaningful)_

## 1.2 Lists at scale・Certainty・Natural

A list/data page must be designed for its **whole range of sizes**, not just the demo
data. Walk the scale — 1 / 2 / 5 / 20 / 100 / 1k–10k rows — and pick the right
mechanism per range: plain render → load-more / pagination → virtual scroll, adding
batch-select / bulk actions once counts get large. Co-design the empty / loading /
error states (§1.1) alongside: a list isn't done until all four render well.

When such a list is **paginated / lazy-loaded**, search and filter must query the **full
set on the server**, not filter only the rows already fetched. A client-side `includes()`
over the loaded page reports "no results" for a match that lives in the not-yet-loaded
remainder — a **false empty**, worse than no search because it asserts absence. (This is
the read-side twin of sorting a paginated list client-side over a partial page.)

> ❌ The Pages "all pages" drawer filters `displayDocuments` with a client-side
> `title/content.includes(keyword)` over the loaded set **and disables load-more while
> searching**, so searching for a page past the loaded window returns "no results" though it
> exists (`AllPagesDrawer/Content.tsx`). ✅ Send the keyword to the server query and page
> through matches.

**Checklist**

- [ ] List designed across 1 → 10k rows (plain → pagination → virtual scroll). _(Certainty)_
- [ ] Batch-select / bulk actions added once counts get large. _(Certainty)_
- [ ] Search / filter over a paginated list queries the full set server-side, not just the loaded page — no false "no results" for unfetched rows. _(Certainty・Meaningful)_
- [ ] Empty / loading / error co-designed with the data state (§1.1). _(Natural)_

## 1.3 Selection visibility in scrolled lists・Certainty・Natural

A capped / scrollable / virtualized list mounts at `scrollTop = 0`. If the active item
sits below the fold, the user lands on a valid selection that is **off-screen** and
reads it as "nothing selected" or a broken page. Any list that can open with a
pre-selected item must **scroll that item into view** — hardest when the selection has
no other anchor (no highlighted parent row, breadcrumb, or header echo), because then
an off-screen active row means **zero** visible feedback. Scroll only when the row is
actually off-screen (`block: 'nearest'`) so an already-visible selection doesn't jump,
and re-run once async rows mount (key off a list-ready signal like row count, not just
the id) so a restored selection still lands when data arrives. Mirror the behavior
across duplicated list variants so it can't regress in just one.

> ✅ The nested thread list is capped to \~9 rows; a thread restored from `?thread=` below the fold is scrolled into view on mount.

**Checklist**

- [ ] Restored / deep-linked active item is scrolled into view on mount. _(Certainty)_
- [ ] Designed for the no-anchor case (parent not highlighted → off-screen = zero feedback). _(Meaningful)_
- [ ] Uses `block: 'nearest'` — an already-visible selection doesn't jump. _(Natural)_
- [ ] Scroll re-runs once async rows mount (keyed off row count). _(Certainty)_
- [ ] Mirrored across duplicated list variants (parallel agent / group lists). _(Certainty)_

## 1.4 Option visibility in pickers・Certainty・Meaningful

Pickers must list every valid target. Watch for options dropped by backend list queries
(pagination, `virtual` flags, scope filters) and add them back. An empty picker must
mean "genuinely none", never "we filtered out the only option".

> ✅ The default "LobeAI" (inbox) agent is `virtual` and excluded from the sidebar list, so the move picker re-adds it.

**Checklist**

- [ ] Picker lists every valid target; backend-dropped options (virtual / scope / pagination) re-added. _(Meaningful)_
- [ ] Empty picker = truly none, not filtered-out. _(Certainty)_

## 1.5 Abbreviate large numbers, roll the unit over・Natural・Certainty

Big counts (tokens, requests, sizes) are for **scanning**, not accounting. Show a
compact abbreviated value and advance the unit at every 1000× boundary — never let a
magnitude pile up inside a smaller unit. `10285.7M` is a bug: past 1000M it should read
`10.3B`; a coefficient that keeps growing digits (`9092.9M`, `10285.7M`) forces the
reader to count zeros and defeats the point of abbreviating. Keep precision compact —
one decimal, drop a trailing `.0` (`1M` not `1.0M`; `9.1B` not `9.09B`) — and put full
precision in a tooltip / detail row. Use the shared helpers rather than re-rolling:
token/usage counts through `formatUsageValue` (`@lobechat/utils`), general shortenings
through `formatShortenNumber`; both already carry the K/M/B/T ladder.

> ✅ `10.3B` ❌ `10285.7M`
> ❌ an ad-hoc `(n / 1_000_000).toFixed(1) + 'M'` that stops at M.

**Checklist**

- [ ] Unit rolls at each 1000× (K→M→B→T); displayed coefficient never ≥ 1000. _(Certainty)_
- [ ] Compact precision: one decimal, trailing `.0` dropped. _(Natural)_
- [ ] Uses shared `formatUsageValue` / `formatShortenNumber`, not an ad-hoc M-capped roll. _(Certainty)_

## 1.6 Default view reflects entry intent & data state・Certainty・Meaningful

A surface with multiple tabs / views / panels has a **landing** selection. Don't
hardcode it to "the first tab" — derive it from (a) how the user got here (the intent
their navigation carried) and (b) which views actually have data. A static default that
lands the user on an empty tab while a sibling holds exactly what they came for reads as
broken. Open on the tab the entry implies (clicked a Skill / file / typed record → the
view that shows it), and fall back to a populated view when the default would be empty.
Decide from resolved state, not mid-load — choosing off an empty in-flight list flips
the tab as data arrives, so hold the static default while loading and switch on
resolved-empty. Once the user manually picks a tab, that choice wins and sticks — track
"user-picked" separately (e.g. a nullable `pickedTab`) so later data changes don't yank
them off it. Pairs with §1.1: the empty state is the fallback _within_ a view; this rule
is about not landing on that empty view when a better one exists.

> ✅ Opening a document page by clicking a **skill** lands the right panel on the **Skills** tab; a plain document lands on **Documents**.
> ✅ An agent with only skills (no documents) opens the panel on **Skills** instead of an empty **Documents** tab.

**Checklist**

- [ ] Lands on the tab the entry intent implies, not a static first tab. _(Meaningful)_
- [ ] Falls back to a populated view when the default would be empty. _(Certainty)_
- [ ] Default decided from resolved state, not mid-load. _(Certainty)_
- [ ] A manual pick is tracked separately and sticks. _(Natural)_

## 1.7 Live / polling streams・Certainty・Natural

A feed that **refreshes on a timer** (polling / subscription — a notification list, a task
brief, an activity stream) is a _News Stream_ pattern, and it owes the user control over
the churn. Silent background updates that reorder rows, or that quietly replace what the
user is reading, break their place and their trust. Three things every live stream needs:
a way to **know** something changed (an unobtrusive "N new" indicator, not a silent swap),
a way to **pull** on demand (a manual refresh, so the user isn't hostage to the interval),
and a promise **not to yank the ground** — don't reorder or drop the row under an active
read/interaction; stage new items and let the user choose to merge them. And a refresh
that _fails_ must not masquerade as "nothing new" — distinguish "failed to refresh" from
"no updates" (pairs with §1.1 and Feedback §4.2).

And when a **control is derived from the live-status map** — a "close all idle" / "clear
inactive" / "archive done" that reads each row's polled status — it must **gate on that
query's loaded/error state**, never on a success-only init flag. An errored or still-loading
status map reads as `{}`, so _every_ row looks inactive and the bulk action becomes a
**wiper**. Treat "unknown / errored / not-yet-loaded" as **ineligible** (disable the action),
never as the inactive value that makes a row a removal target.

> ✅ A feed shows a "3 new" pill the user taps to bring new items in; a manual refresh
> control sits in the header. ❌ A 10s poll silently reshuffles the list mid-read, and a
> failed poll looks identical to an empty feed.
> ❌ The Fleet board's "close idle columns" derives idle from `statusByColumnKey[key] !==
'running'` and gates only on a success-only init flag (`isInit: !isLoading`); when the
> running-topics poll errors the status map empties, **every** open column reads as idle, and
> one click wipes the whole board (`Fleet/idleColumns.ts`, `RunningTaskSidebar.tsx`,
> `useRunningTopics.ts`).

**Checklist**

- [ ] New background items are signaled (indicator / "N new"), not silently swapped in. _(Meaningful)_
- [ ] Manual refresh available — the user isn't hostage to the poll interval. _(Certainty)_
- [ ] Active read/interaction isn't reordered or dropped under the user; new items are staged. _(Natural)_
- [ ] A failed refresh is distinct from "no new items", never shown as empty. _(Certainty)_
- [ ] A bulk/destructive control derived from a live-status map gates on the query's loaded/error state — "unknown/errored" is ineligible, never treated as the inactive value that makes a row a removal target. _(Certainty・Meaningful)_

## 1.8 Find-by-search once a surface has many entries・Natural・Certainty

A surface that grows to **dozens of navigable entries** — a settings area with \~25 tabs, a
long provider/model list, a big command set — outgrows pure browse-by-hierarchy: the user
knows the _name_ of what they want ("proxy", "hotkeys", "billing") but must hunt for it
across grouped menus. Past a threshold, **offer search / filter as a first-class
affordance** — a settings-search box, a jump-to-setting, a filter field over a long list —
so recall beats scanning. This is a **surface-class norm** (mature settings panels —
VSCode / Slack / GitHub / macOS — all ship settings search); a code-only read is blind to
it because an absent search box leaves no `file:line`, so name the class expectation first
and check it as present / missing. Scope: don't add search to a 5-item menu; do add it once
the grouped set is large enough that "which group was that under?" becomes a real question.

> ✅ A settings shell with a search box that filters/jumps across all tabs by name. ❌ The
> settings area has \~25 tabs across 4 accordion groups and **no search** — only browse +
> a single-level breadcrumb (`settings/_layout/Header.tsx`, `_layout/Body/index.tsx`).

**Checklist**

- [ ] A surface with many navigable entries offers search / filter / jump, not browse-only. _(Natural)_
- [ ] Search is named as a class norm up front (mature comparables ship it) so an absent box is caught, not overlooked. _(Certainty)_
- [ ] Scoped to scale — added once the set is genuinely large, not on a short menu. _(Certainty)_
