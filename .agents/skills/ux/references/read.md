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

**On a metrics / aggregate surface the masquerade wears its worst mask: the failure looks
like _real data_, not "empty".** A dashboard's failure default isn't an empty array — it's a
**zero-valued object** (`data?.summary ?? { totalCost: 0, … }`, `?? 0`), so an errored fetch
renders **plausible, legitimate-looking numbers** — "this agent cost you $0.00 / 0 tokens" —
with nothing on screen signalling anything went wrong. This is strictly worse than the list
case: an empty list at least invites suspicion ("did this fail?"); a confident `$0`, by
contrast, reads as the truth. Same fix, higher stakes: always read `error`, then branch to a
failed state before rendering any aggregate — never fall through to a zero default. Three
states, not one: failed (reason + Reload), genuinely-zero (a real empty page), and real data
are different screens.

> ❌ **Agent stats / Usage & Cost** (`/agent/:aid/stats`) reads only `{ data, isLoading }`
> from `useAgentUsageStats` — **`error` unread** (`AgentUsage/index.tsx:46`) — then coerces a
> failure into `summary={data?.summary ?? EMPTY_SUMMARY}` (all zeros, `index.tsx:98`),
> `rows={data?.byModel ?? []}`, and an empty chart. A 500 / offline / auth failure renders a
> confident **"$0.00 cost, 0 tokens"** dashboard, no reason, no retry — indistinguishable
> from an agent that genuinely hasn't run. ✅ Branch `error` → a failed card with Reload
> (`mutate`); show the zero/empty page only on `!error && totalRequests === 0`.
> ❌ A detail page that `return null`s until its record loads is **not** a loading state — it's a blank flash on the happy path and a **permanent blank** if the fetch fails (no skeleton, no error): **Eval** run / case / dataset detail all `if (!record) return null` (`eval/bench/[benchmarkId]/runs/[runId]/index.tsx`, `.../cases/[caseId]/index.tsx`, `.../datasets/[datasetId]/index.tsx`). Render a skeleton, then an error state.
> ❌ **Resource** repeats the failure-as-empty trap four times: the Explorer reads only `{ isLoading, isValidating }` (the swr already exposes `error`, unread) so a failed resource fetch renders the "create your first resource" onboarding (`ResourceManager/components/Explorer/index.tsx`, `EmptyPlaceholder.tsx`); the sidebar KB list (`resource/(home)/_layout/Body/LibraryList/index.tsx`), the search overlay (`SearchResultsOverlay.tsx` → false "no results"), and the folder tree (`LibraryHierarchy/index.tsx` → false "add folder") all do the same.

**A third mask: the failed fetch hidden behind a non-empty _static_ fallback.** When a list is
assembled by **merging a fetched set with a static / frontend-only set** — `[...fetched,
...PLACEHOLDERS]`, a catalog padded with "coming soon" rows, defaults spliced in — a failed
fetch doesn't even read as empty: the static half keeps `length > 0`, so **both** a `length ===
0 → <Empty>` guard **and** an `error`-unread call site render a **plausible partial catalog**,
silently dropping the entire fetched half. A `fallbackData: []` on the fetch makes it automatic.
Read `error` and branch a failed state _before_ merging in the static entries — a non-empty
length is not proof the fetch succeeded.

> ❌ **Channel** (`/agent/:aid/channel`) reads only `{ data, isLoading }` from
> `useFetchPlatformDefinitions` / `useFetchBotProviders` (`channel/index.tsx:37-42`), both with
> `fallbackData: []` (`store/agent/slices/bot/action.ts:122,130`). A failed platform-definitions
> fetch → `platforms = []` → `allPlatforms` becomes just the frontend-only
> `COMING_SOON_PLATFORMS` (`index.tsx:62-68`), so `allPlatforms.length > 0` stays true and the
> surface renders a **coming-soon-only catalog** — every real and already-connected channel gone,
> no error, no retry; a failed providers fetch makes a configured bot read as never-connected,
> inviting a duplicate credential re-entry. ✅ Branch `error` before assembling the merged list.

**Distinguishing the two empty variants is a call-site wiring job, not just a component one.** A common miss: the `Empty` component _already_ ships a `search` / "no match" variant, but the list renders it **bare** and never passes the flag — so a legitimate zero-result search shows the first-run "create your first…" onboarding, and the built variant + its i18n keys are dead code. The query is in scope at the call site; thread it in (`search={!!q || !!category}`) and add a clear-filters action.

> ❌ **Discover / Community** lists: all five `*Empty` components take a `search?: boolean` that swaps to the "no results" copy (`community/features/AssistantEmpty.tsx:11-27` + McpEmpty / ModelEmpty / ProviderEmpty / SkillEmpty twins), but every `features/List/index.tsx:17` renders `<XEmpty/>` with **no prop** (`grep 'search={'` over the area → 0 hits), so `q=zzznomatch` returns zero rows and shows the onboarding empty with no clear-filters — the built variant unreachable. (`SearchResultCount.tsx`, a "N results for X" affirmation, is likewise imported by nothing.) ✅ Pass `search` from the page → `List` → `Empty` and add a clear-filters CTA.

**Failure is also not "not found".** A detail page that coerces a fetch failure into a **404 /
"doesn't exist"** terminal is the same masquerade wearing a different mask: it tells the user the
record was **deleted** when the load merely **errored** (and a 404 is a dead-end — no Reload).
Distinguish `error` (transient → reason + retry, keep the URL) from a resolved not-found
(`!isLoading && !data && !error` → the real 404). Read `error` before falling to `NotFound`.

> ❌ **Resource** library detail: `const { data, isLoading } = useKnowledgeBaseItem(id)` then
> `if (!isLoading && !data) return <NotFound/>` (`resource/library/index.tsx`) — a network / 500
> on the KB fetch renders the permanent "this library doesn't exist" 404, so the user thinks it
> was deleted and gets no retry. ✅ Branch `error` to a reload state; keep 404 for a genuine miss.
> ❌ **Task detail** bakes the same conflation into the fetcher: `fetchTaskDetail` `throw`s
> `Task not found` when `result.data` is falsy **and** lets any network / 500 rejection propagate
> the same way (`store/task/slices/detail/action.ts:124-129`), then `isNotFound = !!taskError &&
!hasTaskDetail` (`useActiveTaskDetail.ts:60`) renders a terminal `NotFound` whose only action is
> "Back to tasks" (`TaskDetailPage.tsx:39-59`). A transient failure tells the user the task was
> **deleted** and offers no Reload. The rest of the machine is right (skeleton gated on
> "resolving", not `data === undefined`) — the miss is treating _errored_ and _absent_ as one
> signal. ✅ Distinguish them: a thrown "not found" → 404, a fetch rejection → reload state.
> ❌ **Memory** (记忆) detail panels do it in blank form: all five `*RightPanel.tsx` read only
> `{data, isLoading}` and set the body only in the `isLoading` / `data` branches
> (`memory/contexts/features/ContextRightPanel.tsx` + 4 twins), so a fetch **error** and a resolved
> **not-found** (deleted item) both render an empty panel forever — no skeleton, no reason, no
> reload, deleted indistinguishable from failed-to-load; and the Memory **home** page falls to the
> "analyze to get started" onboarding empty when a persona/tags fetch fails (`memory/(home)/index.tsx`).

**Checklist**

- [ ] Empty state is a real page with explanation + CTA, not a blank screen. _(Meaningful)_
- [ ] Empty variants distinguished: "no data yet" vs "no filter match". _(Certainty)_
- [ ] Error is checked **before** the empty branch — a failed fetch never renders as empty (`!error && length === 0` gates empty); read `error`, don't coerce `data ?? []`. _(Certainty・Meaningful)_
- [ ] On a **metrics / aggregate** surface (dashboard, stats, cost), a failed fetch never falls through to a **zero-valued default** (`data?.summary ?? {…:0}`, `?? 0`) — a confident `$0` reads as real data, not "empty"; branch `error` before rendering any aggregate. _(Certainty・Meaningful)_
- [ ] A list merged from a fetched set + a **static/frontend set** (`[...fetched, ...placeholders]`, a catalog padded with "coming soon" rows) branches `error` **before** merging — a failed fetch there keeps `length > 0` via the static entries, so neither the empty guard nor an error-unread call site catches it (a plausible partial catalog); `fallbackData: []` makes it automatic. _(Certainty・Meaningful)_
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

The **cleanest way to make this hold by construction** — and get deep-linking + state-restore
for free — is to make the **URL the single source of truth for the list's read state** (`q`,
`sort`, `filter`/`category`, `page`) and **derive the fetch key from those params**, rather
than holding them in local component state. Then filter / sort / search / paginate are
**server queries by definition** (the key changed → the server re-ran), not client passes
that can drift from the server's page; the browse state is shareable / restorable from the
URL; and there's no local-vs-server divergence to reconcile. Reach for this whenever a list
has more than one read-state dimension — the alternative (local `useState` per control + a
manual refetch) is where the partial-page traps breed.

**Getting the search box server-side is not the whole job.** _Every_ read dimension that
narrows, reorders, or **summarizes** the set must run server-side too — a surface can query
search correctly and still lie through the other dimensions, each held client-side over the
loaded page: a **facet filter** (status / type / date) hides matches on unfetched pages → a
**false empty**; a **sort** (by title / created) orders only the loaded rows while lazy-loaded
later pages append out of order → a list that visibly _isn't_ sorted; a **count badge** that
tallies the loaded rows **under-reports** ("Completed 3" when 40 exist unfetched); and a **bulk
action scoped to "the filtered set"** (archive-stale, select-all-then-act) silently operates on
the partial page only. A per-dimension audit that greenlights the surface because "search hits
the server" misses the four that don't — so check filter, sort, the counts, and bulk-scope
_each_ against the full set, not just the search input.

> ❌ **Agent topics** (`/agent/:aid/topics`) infinite-scrolls 30 rows/page but applies **all**
> of status/trigger/time/project filtering, `sortTopics`, grouping, and the per-status **count
> badges** client-side over the loaded pages (`AgentTopicManager/index.tsx:99-140`,
> `utils.ts:68`), while only **search** goes server-side (BM25, `useSearchTopics`). So sorting
> by title orders just the loaded rows (later pages append unsorted), filtering to a rare status
> shows a **false "no match"** with matches unfetched, the tab counts under-report, and "Archive
> stale >3mo" (`Toolbar.tsx:349`) mutates only the loaded page — the search dimension is right,
> the other four lie. The kicker: `getTopics` **already accepts** `excludeStatuses` /
> `excludeTriggers` (the sidebar's `loadMoreTopics` passes them, `store/chat/slices/topic/action.ts:724-734`);
> the management fetch just omits them. ✅ Send filter/sort into the query, or lift the read-state
> to the URL + fetch key (above).

> ❌ The Pages "all pages" drawer filters `displayDocuments` with a client-side
> `title/content.includes(keyword)` over the loaded set **and disables load-more while
> searching**, so searching for a page past the loaded window returns "no results" though it
> exists (`AllPagesDrawer/Content.tsx`). ✅ Send the keyword to the server query and page
> through matches.
> ✅ **Memory** (记忆) does it right: each list tab passes `q` straight into the paginated
> `queryMemories` server call (`memory/contexts/index.tsx:57-62`, mirrored per tab), so search spans
> the whole set — no false "no results" for unfetched rows.
> ✅ **Discover / Community** lists take the sub-rule to its conclusion: every read dimension
> (`q` / `sort` / `category` / `page` / `source`) lives in the URL and flows into the SWR key
> (`libs/swr/keys.ts`; read via `useQuery()` at `community/(list)/agent/index.tsx:16`), so
> filter·sort·search·paginate are **all server re-queries** and the whole browse state is
> deep-linkable — none of the client-over-partial-page traps that bit the other list audits
> can occur here. (This is why the surface's only read-side gap is failure handling, not
> query correctness.)

> ❌ The Pages "all pages" drawer filters `displayDocuments` with a client-side
> `title/content.includes(keyword)` over the loaded set **and disables load-more while
> searching**, so searching for a page past the loaded window returns "no results" though it
> exists (`AllPagesDrawer/Content.tsx`). ✅ Send the keyword to the server query and page
> through matches.
> ✅ **Memory** (记忆) does it right: each list tab passes `q` straight into the paginated
> `queryMemories` server call (`memory/contexts/index.tsx:57-62`, mirrored per tab), so search spans
> the whole set — no false "no results" for unfetched rows.

**Checklist**

- [ ] List designed across 1 → 10k rows (plain → pagination → virtual scroll). _(Certainty)_
- [ ] Batch-select / bulk actions added once counts get large. _(Certainty)_
- [ ] Search / filter over a paginated list queries the full set server-side, not just the loaded page — no false "no results" for unfetched rows. _(Certainty・Meaningful)_
- [ ] Server-side coverage isn't just the search box — **sort, facet filters, the count badges, and any "act on the filtered set" bulk op** each query/compute over the full set too; server-side search + client-side sort/filter/counts still false-empties, mis-orders across pages, and under-counts. _(Certainty・Meaningful)_
- [ ] Multi-dimension list read-state (`q`/`sort`/`filter`/`page`) lives in the URL and the fetch key derives from it — server-query, deep-link, and restore by construction, not local state + manual refetch. _(Certainty・Natural)_
- [ ] Empty / loading / error co-designed with the data state (§1.1). _(Natural)_

## 1.3 Selection visibility in scrolled lists・Certainty・Natural

A capped / scrollable / virtualized list mounts at `scrollTop = 0`. If the active item
sits below the fold, the user lands on a valid selection that is **off-screen** and
reads it as "nothing selected" or a broken page. Any list that can open with a
pre-selected item must **scroll that item into view** — hardest when the selection has
no other anchor (no highlighted parent row, breadcrumb, or header echo), because then
an off-screen active row means **zero** visible feedback. Scroll only when the row is
actually off-screen (`block: 'nearest'`, plus `inline: 'nearest'` / `'end'` for a
**horizontally**-scrolling list — the axis follows the list's scroll direction) so an
already-visible selection doesn't jump. And **time the scroll to when the target node
actually exists** — there are two triggers, not one: for rows arriving **async from a
fetch**, re-run keyed off a list-ready signal (row count, not just the id) so a restored
selection lands when data arrives; for a row you **add imperatively in the same handler**
(open-and-scroll / add-and-scroll), the node isn't in the DOM until React commits, so a
synchronous `scrollIntoView` finds nothing — defer to the paint (a `requestAnimationFrame`,
or a **double** rAF to clear the commit frame) before querying it. Mirror the behavior
across **every** entry point that opens/adds an item (and every duplicated list variant)
so it can't regress in just one.

> ✅ The nested thread list is capped to \~9 rows; a thread restored from `?thread=` below the fold is scrolled into view on mount.
> ✅ The **Fleet** board scrolls a (re-)opened or newly-added column into the horizontally-scrolling
> band with `scrollIntoView({ block: 'nearest', inline: 'end' })` after a **double `requestAnimationFrame`**
> (so the query runs post-paint, once React has committed the new column) — and it's mirrored across
> **both** entry points, sidebar activate and the "+" add button (`RunningTaskSidebar.tsx` `handleActivate`,
> `AddColumnButton.tsx`), so neither path can regress alone.
> ❌ **Memory** (记忆) list/grid: clicking a card deep-links `?contextId=` and opens the detail
> panel, but the Virtuoso list mounts at `scrollTop=0` and nothing scrolls the active card into
> view, and the cards take no `active` prop / highlight (`memory/**/TimeLineView`, `**/GridView`,
> `*Card.tsx`) — a restored selection below the fold shows **zero** list feedback (the no-anchor case).

**Checklist**

- [ ] Restored / deep-linked active item is scrolled into view on mount. _(Certainty)_
- [ ] Designed for the no-anchor case (parent not highlighted → off-screen = zero feedback). _(Meaningful)_
- [ ] Uses `block: 'nearest'` (and `inline: 'nearest'` / `'end'` on a horizontal list — axis follows the scroll direction) so an already-visible selection doesn't jump. _(Natural)_
- [ ] Scroll is timed to the target node existing — keyed off a list-ready signal (row count) for **async-arriving** rows, or deferred to the paint (`requestAnimationFrame` / double rAF) for a row **added imperatively in the same handler**. _(Certainty)_
- [ ] Mirrored across **every** open/add entry point (and every duplicated list variant — parallel agent / group lists) so it can't regress in one path. _(Certainty)_

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
> ❌ **Discover / Community** registry cards render social-proof counts **verbatim** — `{installCount}` / `{stars}` / `{commentCount}` in `skill/features/List/MetaInfo.tsx` + the mcp twin (a popular server prints `40000`), and agent `TokenTag.tsx:43` uses `formatIntergerNumber` instead of the `formatUsageValue` ladder — while `formatShortenNumber` is already imported one directory over in `community/features/LikeButton.tsx`. Install/star counts are a scanning metric; roll them.

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

And **conditional** polling (poll only _while_ something is in flight) must start from **reactive
state**, not from a function passed to the fetcher's `refreshInterval`. SWR's function-form
`refreshInterval` is re-evaluated **only after a timer fires**, so if its first evaluation returns
`0` (nothing in flight yet — the common cold-start), no timer is ever scheduled and polling
**silently never starts**, even once work begins. Derive a reactive `shouldPoll` boolean from the
store and pass `refreshInterval: shouldPoll ? interval : 0` so a re-render (not a stale timer) turns
the poll on the moment activity appears, and off the moment it settles.

> ✅ A feed shows a "3 new" pill the user taps to bring new items in; a manual refresh
> control sits in the header. ❌ A 10s poll silently reshuffles the list mid-read, and a
> failed poll looks identical to an empty feed.
> ❌ The Fleet board's "close idle columns" derives idle from `statusByColumnKey[key] !==
'running'` and gates only on a success-only init flag (`isInit: !isLoading`); when the
> running-topics poll errors the status map empties, **every** open column reads as idle, and
> one click wipes the whole board (`Fleet/idleColumns.ts`, `RunningTaskSidebar.tsx`,
> `useRunningTopics.ts`).
> ✅ **Task detail** polls the activity feed only while a run is live and starts it correctly: a
> reactive `shouldPoll = hasInFlightActivity(detail)` selector feeds `refreshInterval: shouldPoll ?
TASK_DETAIL_POLL_INTERVAL : 0` (`store/task/slices/detail/action.ts:300-315`), so a re-render turns
> polling on when work appears and off when it settles — dodging the function-form `refreshInterval`
> cold-start trap (its own comment spells out why) and never hammering a finished task.

**Checklist**

- [ ] New background items are signaled (indicator / "N new"), not silently swapped in. _(Meaningful)_
- [ ] Manual refresh available — the user isn't hostage to the poll interval. _(Certainty)_
- [ ] Active read/interaction isn't reordered or dropped under the user; new items are staged. _(Natural)_
- [ ] A failed refresh is distinct from "no new items", never shown as empty. _(Certainty)_
- [ ] Conditional polling starts from **reactive state** (`shouldPoll` boolean → `refreshInterval`), not a function-form `refreshInterval` — the function form never schedules a first timer if its initial value is `0`, so polling silently never starts. _(Certainty・Natural)_
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

## 1.9 Marketplace / registry browse cards carry lifecycle + trust state・Meaningful・Certainty

A **browse card in a marketplace / registry** (agents, models, providers, plugins/MCP,
skills, extensions, templates) is not a static poster — the class carries a small set of
affordances every mature comparable ships (VS Code Marketplace, npm, HuggingFace Hub,
Raycast Store, Ollama library, the GPT / MCP stores), and a code-only read is **blind to the
absent ones** because a never-built badge leaves no `file:line`. Name the class expectations
first, then check each **present / partial / absent** on the tile:

- **Owned / installed / added state.** The card reflects whether _this user_ already has the
  item — an "Installed ✓" / "Added" badge (and ideally an inline add for bulk↔single parity),
  so a user scanning the grid doesn't re-add what they own or open a detail page to find out.
  The state usually already exists one level down (a detail-page install button reading an
  `isInstalled` selector); the miss is not surfacing it on the tile.
- **Trust / provenance badges, consistently across sibling registries.** Verified / official /
  author markers — and applied the **same way** across sibling lists. When one registry's card
  badges "official" and its sibling's card (equally third-party, equally installable) shows no
  trust mark at all, a user can't judge either. Define **one card contract** per registry
  class (owned-state · install/star count · trust badge · what's-inside) and apply it to all.
- **No-results distinct from first-run** (see §1.1) and **counts abbreviated** (see §1.5).
- **Contribute → an in-app submit**, not a dead-end to external docs / a GitHub repo (Grow §5.3).

This is a **surface-class norm**: write the expected-capability list from the comparables
_before_ reading code, then audit gaps against it — otherwise the read only polishes the
paths that already exist and blesses the absent ones.

> ✅ A model card shows "Added" on models already enabled in the workspace and a hover "Add"
> for the rest; official models carry a verified check, same as the provider list.
> ❌ **Discover / Community** cards show avatar / title / author / stats but **no
> owned/installed state** on any of the five list `Item.tsx` (add/install lives only on the
> detail; `(detail)/mcp/.../ActionButton` already reads `pluginSelectors.isPluginInstalled`,
> the list just doesn't). The **mcp** card badges official/validated (`mcp/features/List/Item.tsx:157-191`)
> but the **skill** card carries no trust mark though skills are equally installable, and
> "Create" opens a docs modal → GitHub (`CreateButton/Inner.tsx:44-50`) with no in-app submit.

**Checklist**

- [ ] Registry/marketplace browse cards reflect owned / installed / added state on the tile, not only on the detail page. _(Meaningful)_
- [ ] Trust / verified / official badges applied via one card contract, consistently across sibling registries (no "official on one list, nothing on its twin"). _(Certainty・Meaningful)_
- [ ] Class-norm capabilities (owned-state, trust badge, counts, no-results≠first-run, contribute→in-app-submit) listed from comparables up front, so an absent one is caught. _(Certainty)_

## 1.10 Reuse the canonical list / nav row — don't hand-roll sidebar chrome・Certainty・Natural

A navigation / list **sidebar** (topic list, report list, resource tree — any master-detail
left panel) is a **solved surface class** in this codebase, and the polish is in the shared
primitive, not in the individual screen. Rows go through **`NavItem`**
(`src/features/NavPanel/components/NavItem.tsx`); collapsible groups through
**`Accordion` / `AccordionItem`** (via the shared **`GroupedAccordion`** engine); the active
row through **`Block variant='filled'`**; spacing through `Flexbox` / `Block` `gap` /
`padding` props, never hand-picked px. Composing those buys — for free, and identical to every
sibling panel — the four things bespoke rows get wrong:

1. **The highlight box _is_ the padded content box.** `NavItem` makes the interactive
   `Block` the hover/active surface, so the highlight always aligns to the row and content
   can't bleed to the panel edge. A hand-rolled row whose list-container padding, item
   padding, and highlight radius are chosen independently produces a highlight rectangle that
   floats / insets differently from the text, and text that runs to the viewport edge.
2. **The app-wide active treatment.** `variant={active ? 'filled' : 'borderless'}` is _the_
   active row everywhere. A bespoke `data-active` + `colorFillSecondary` is a slightly-off
   look that no longer matches the panel next to it.
3. **A right-aligned `extra` slot + hover-revealed actions**, already solved (timestamp /
   count on the right; `.nav-item-actions` reveal on `:hover`). Re-implementing the
   `opacity: 0 → 1` reveal by hand is code that will drift.
4. **Grouping at scale.** The canonical sidebar offers by-project / by-status / by-time
   collapsible `Accordion` groups; a hand-rolled panel is almost always a **flat, ungrouped
   dump** that has no structure once the list grows past a screen.

The row is also where **Edit** (inline rename) and **Act** (delete / overflow menu) live —
hand-rolling the row drags those into raw `<input>` / raw `<button>` too, missing the shared
inline-edit and confirm patterns. Each miss is individually tiny; the sum is exactly what
"做的非常不成熟 /unpolished" means. **Before building any left-panel list, grep the sibling
surface (`NavItem`, `Accordion`, `GroupedAccordion`) and compose it**; fall to raw elements
only for a genuinely novel row. (Component-priority _mechanics_ are in **react**; this is the
UX consequence — a bespoke row is a visible consistency + craft regression.)

> ✅ **Topic sidebar** (`routes/(main)/agent/_layout/Sidebar/Topic/**`) composes `NavItem` rows
> inside `Accordion` groups via one shared `GroupedAccordion` engine (by-project / by-status /
> by-time), `Block variant='filled'` for the active row, and spacing as `Flexbox` / `Block`
> props — every row aligns to its highlight and matches every other panel in the app.
> ❌ **Verify report sidebar** (`features/Verify/Workspace/ReportListPanel.tsx`) hand-rolls the
> entire panel: a raw grid `<div className={styles.item}>` row with `data-active` +
> `colorFillSecondary` (instead of `NavItem` / `Block variant`), a bordered `<label>` + `<input>`
> search box, a raw `<input>` inline-rename, an `opacity`-toggled action reveal re-implemented in
> CSS, and a **flat, ungrouped** list — so the hover box misaligns from the text, content bleeds
> to the panel edge, and the surface reads as off-rhythm next to the topic sidebar it sits beside.

**Checklist**

- [ ] Sidebar / nav list rows go through the canonical `NavItem` (or the surface's shared row primitive), not a hand-rolled `<div>` / `<button>` — so hover/active is the app-wide treatment and the highlight box **is** the padded content box (no floating/misaligned highlight, no edge-bleed). _(Certainty)_
- [ ] Active row uses `Block variant='filled'` (the shared active treatment), not a bespoke `data-active` + `colorFill*` re-derivation. _(Certainty)_
- [ ] Grouping at scale reuses `Accordion` / `GroupedAccordion` (by-project / status / time), not a flat ungrouped dump once the list grows past a screen. _(Natural)_
- [ ] Search box, inline-rename, and row actions reuse the shared input / editing / action-reveal patterns, not raw `<input>` / `<label>` + hand CSS. _(Certainty)_
- [ ] Spacing/padding expressed as `Flexbox` / `Block` `gap` / `padding` props (inherits the sidebar rhythm), not hand-picked px constants. _(Natural)_
