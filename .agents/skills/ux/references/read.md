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

> ✅ An empty "Connect your first device" page with primary/secondary connect paths and "what you can do once connected" cards.
> ✅ The agent **Documents** tab keeps its new-folder / new-doc toolbar and renders an `Empty` below it when there are no documents.
> ❌ A bare title over skeleton rows, or a toolbar over dead space.

**Checklist**

- [ ] Empty state is a real page with explanation + CTA, not a blank screen. _(Meaningful)_
- [ ] Empty variants distinguished: "no data yet" vs "no filter match". _(Certainty)_
- [ ] Always-rendered chrome still renders a body empty placeholder. _(Meaningful)_
- [ ] Loading designed (skeleton / NeuralNetworkLoading), no layout shift. _(Natural)_
- [ ] Error designed with reason + retry/back path. _(Meaningful)_

## 1.2 Lists at scale・Certainty・Natural

A list/data page must be designed for its **whole range of sizes**, not just the demo
data. Walk the scale — 1 / 2 / 5 / 20 / 100 / 1k–10k rows — and pick the right
mechanism per range: plain render → load-more / pagination → virtual scroll, adding
batch-select / bulk actions once counts get large. Co-design the empty / loading /
error states (§1.1) alongside: a list isn't done until all four render well.

**Checklist**

- [ ] List designed across 1 → 10k rows (plain → pagination → virtual scroll). _(Certainty)_
- [ ] Batch-select / bulk actions added once counts get large. _(Certainty)_
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

> ✅ A feed shows a "3 new" pill the user taps to bring new items in; a manual refresh
> control sits in the header. ❌ A 10s poll silently reshuffles the list mid-read, and a
> failed poll looks identical to an empty feed.

**Checklist**

- [ ] New background items are signaled (indicator / "N new"), not silently swapped in. _(Meaningful)_
- [ ] Manual refresh available — the user isn't hostage to the poll interval. _(Certainty)_
- [ ] Active read/interaction isn't reordered or dropped under the user; new items are staged. _(Natural)_
- [ ] A failed refresh is distinct from "no new items", never shown as empty. _(Certainty)_
