# Worked example — Agent stats / Usage & Cost (统计) audit

A real run of this skill against the per-agent usage & cost dashboard
(`/agent/:aid/stats` → `src/features/AgentUsage`), 2026-07-02 (LOBE-11218, under the
Chat / 会话 UX-Audit parent LOBE-11145). Use it as a **template for the output shape**, not as
current-state truth (the code moves; re-verify before citing).

Surface = a single scrolling column of three `Block` cards: **① summary stat cards**
(cost / cache savings / token) with a dimension (day/week) + range (7/30/90d) toolbar →
**② "when this agent spent" stacked bar chart** with a spend/token toggle → **③ per-model
breakdown table**. Chrome = `NavHeader` + `AgentBreadcrumb`.

**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic +
CLS) ⏳ not yet run — see §5. Verdicts about the render (chart sparseness, does $0 read as
real data) are L1 inferences here, pending L2 confirmation.

**Surface class & its norms (benchmark first).** This is a **usage / cost dashboard** — the
reference class is Anthropic Console usage, the OpenAI usage dashboard, Vercel/Stripe
analytics, AWS Cost Explorer. Class norms an L1 code-read is otherwise blind to (each
checked below): date-range + granularity control ✅; **period-over-period comparison** (▲/▼ %
vs previous range) ✗; **export / download** (CSV) ✗; **drill-down** from an aggregate to the
records that produced it ✗; a purpose-built **empty / no-usage** state ✗; **failure ≠ $0** ✗.

## 1 — Patterns in use

| Pattern (family)                      | Where                                                                                                  | Rating | Note                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------- |
| Visual Framework (layout)             | `NavHeader` + `WideScreenContainer` centered column (`index.tsx:52`)                                   | ✅     | consistent app chrome                                                |
| Titled Sections / Card Stack (layout) | three `Block variant="outlined"` cards (`index.tsx:63,101,104`)                                        | ✅     | clean top-to-bottom read                                             |
| Breadcrumbs (nav)                     | `AgentBreadcrumb` with `usageStats.title` (`index.tsx:56`)                                             | ⚠️     | renders `null` when no active agent (`index.tsx:55`)                 |
| Sortable Table (data)                 | per-model breakdown `antd Table` (`ModelBreakdown.tsx:65`)                                             | ⚠️     | `pagination={false}`, columns not actually sortable, no row → detail |
| Dynamic Queries (data)                | day/week + 7/30/90d `Segmented` (`index.tsx:69,83`); spend/token toggle (`UsageTrendChart.tsx:51`)     | ⚠️     | selection is `useState` — not persisted, not in URL (gap ④)          |
| Datatips / Data Brushing (data)       | `BarChart` stacked series with tooltips (`UsageTrendChart.tsx:63`)                                     | ✅     | interactive read of input/output/cache                               |
| Number formatting (data)              | `formatUsageValue` / `formatNumber` / `formatTokenNumber` everywhere                                   | ✅     | shared unit-rolling helpers, Read §1.5 (highlight)                   |
| Skeleton loading (feedback)           | chart `Skeleton.Block height={320}` (`UsageTrendChart.tsx:61`)                                         | ✅     | height matches the loaded chart exactly, 0 CLS (highlight)           |
| Loading Indicator (feedback)          | `StatisticCard` antd `Spin` (`StatisticCard/index.tsx:166`); table antd spin (`ModelBreakdown.tsx:70`) | ⚠️     | antd `Spin`, not project loader / skeleton (gap ⑥)                   |
| Failure + Retry (feedback)            | —                                                                                                      | —      | **absent** — no error branch anywhere (gap ①)                        |
| Empty-state as onboarding (growth)    | —                                                                                                      | —      | **absent** — no "no usage yet" page (gap ②)                          |
| Overview + Detail / drill-down (data) | —                                                                                                      | —      | **absent** — no aggregate → source-records path (gap ⑤)              |
| Comparison / trend delta (data)       | —                                                                                                      | —      | **absent** — `TitleWithPercentage` exists but unused (gap ⑤)         |

**Read:** layout, number formatting, and the chart skeleton are mature. The weakness
clusters hard in **Feedback (no failure state at all)** and **Read §1.1 (failure and empty
both collapse into a plausible `$0` dashboard)** — the defining flaw of this surface.

## 2 — Strengths / good cases (don't regress)

This surface is thin, but three behaviors are done right and are the "don't regress" list:

- **✅ 亮点 — Chart skeleton matches the loaded chart's exact height (→ candidate ✅ for ux
  Feedback §4.1).** The loading placeholder is `Skeleton.Block height={320}` and the real
  `BarChart` is `height={320}` (`UsageTrendChart.tsx:61,64`) — same pixel height, so the
  loading→content swap causes **zero layout shift**. This is the concrete, numeric form of
  "skeleton matches the content's height" and worth citing as the ✅ beside §4.1.
- **✅ 亮点 — Consistent shared number formatting.** Every value routes through
  `formatUsageValue` / `formatNumber` / `formatTokenNumber` (`StatCards.tsx`,
  `UsageTrendChart.tsx`, `ModelBreakdown.tsx`) rather than ad-hoc `toLocaleString`, so units
  roll consistently (Read §1.5) across cards, chart axis, and table.
- **✅ 亮点 — Model rows are truncation-safe.** Each breakdown row pairs `ModelIcon` + an
  `ellipsis` model name over a secondary `provider` line (`ModelBreakdown.tsx:24-34`), so a
  long model id degrades gracefully instead of breaking the row.

## 3 — Experience gaps (ranked)

**① A failed fetch renders as a real-looking `$0` dashboard — ux Read §1.1 / Feedback §4.2**
🔴 `useAgentUsageStats` returns only `{ data, isLoading }`; **`error` is never read**
(`index.tsx:46`). On any network / 500 / auth failure SWR resolves to `data === undefined`,
`isLoading === false`, and the page coerces the failure into **plausible zero data**:
`summary={data?.summary ?? EMPTY_SUMMARY}` shows **$0.00 cost / 0 tokens** (`index.tsx:98`),
`buckets={data?.buckets}` → an empty chart, `rows={data?.byModel ?? []}` → an empty table
(`index.tsx:102,105`). This is worse than the classic `data ?? [] → <Empty>` masquerade:
the failure doesn't even read as "empty", it reads as **legitimate data — "this agent cost
you nothing"** — with no reason and **no retry anywhere**. Remedy: read `error`; when
`error`, render a failed state (reason + Reload/`mutate`) _before_ any aggregate is shown;
only show data on `!error`.

**② No empty / "no usage yet" state — ux Read §1.1** 🟠 When the agent genuinely has no
assistant messages in range the server returns zeros + empty arrays
(`apps/server/.../usage/index.ts:253`, buckets built only from rows), and the client renders
the same `$0` cards, a blank chart plot, and antd Table's default "No Data"
(`ModelBreakdown.tsx:65`). There is no purpose-built empty page explaining _what this is,
why it's empty, and a next action_ (e.g. "This agent hasn't run in the last 30d — start a
chat"). "No usage yet", "load failed", and "genuinely $0" are three different situations
rendered identically. Remedy: a real empty page for `!error && !isLoading && totalRequests === 0`, distinct from the error state in ①.

**③ No-active-agent falls through to a silent zero dashboard — ux Read §1.1/§1.6** 🟠 If
`activeAgentId` is nullish the SWR key is `null` → no fetch, `isLoading === false`, `data === undefined` → the full `$0` dashboard renders under a **`null` breadcrumb**
(`index.tsx:55-58,46`). No loading, no guidance — just wrong-looking empty content. Remedy:
gate on a resolved agent id and show a loading/guidance state until it exists.

**④ Range / granularity / chart-type not persisted, not in URL — Certainty (Deep-linking)**
🟡 `range`, `granularity` (`index.tsx:43-44`) and the chart spend/token toggle
(`UsageTrendChart.tsx:27`) are all local `useState`. A reload resets to 30d / day / spend,
and the view is not shareable or bookmarkable — a cost view someone wants to send ("look at
90d") can't be linked. Remedy: lift the selections to URL search params (Deep-linking).

**⑤ Dashboard dead-ends: no comparison, no export, no drill-down — class norms + Grow §5.3**
🟡 Three usage/cost-dashboard class norms are absent, and one has a _ready but unused_
building block:

- **Period-over-period comparison** — `StatCards` uses bare `StatisticCard` with no prior
  value (`StatCards.tsx:30-67`), yet the design system already ships `TitleWithPercentage` /
  `growthPercentage` (`components/StatisticCard/…`) precisely for "▲ +12% vs previous
  period". The capability exists and is simply not wired.
- **Export / download** — no CSV/export of the breakdown; a cost surface people reconcile
  against invoices should offer it.
- **Drill-down (Overview + Detail)** — clicking a model row or a chart bucket leads nowhere;
  the surface can't answer "what did this $ come from" by linking to the driving
  conversations. This is the Grow §5.3 closed-loop gap: a metrics pane that doesn't lead
  onward to the records it summarizes.

**⑥ Loading uses antd `Spin`, inconsistent with the chart skeleton — ux Feedback §4.1** 🟡
The chart loads with a `Skeleton.Block` (✅) but the stat cards spin via `StatisticCard`'s
`<Spin percent="auto"/>` (`StatisticCard/index.tsx:166`) and the table uses antd Table's
built-in spin (`ModelBreakdown.tsx:70`). Feedback §4.1 bans antd `Spin` in favor of
skeletons / project loaders, and the three blocks loading in three different visual idioms
reads as unpolished. Remedy: skeleton the cards and table to match the chart.

**⑦ Trend chart is not zero-filled → a sparse, misleading timeline — pending L2** 🟡 The
server creates a bucket only for days that have messages (`usage/index.ts:253,274-286`), so a
30-day range with 3 active days renders **3 bars**, not a 30-slot timeline with gaps — the
"when this agent spent" shape is distorted and the x-axis lies about the range. L1 flags the
data shape; the visual severity is an **L2** confirm. Remedy: zero-fill buckets across the
full `[startAt, endAt]` at the requested granularity.

## 4 — Skill feedback (回灌)

- **New generalizable gap → landed in `ux` (mandatory close).** Read §1.1's existing ❌
  examples are all the _list_ form of the masquerade (`data ?? [] → <Empty>`). This surface
  reveals a **latent sub-rule**: on a **metrics / aggregate** surface the failure default is
  a _zero-valued object_ (`?? EMPTY_SUMMARY`, `?? 0`), so the failure renders as **real-looking
  data ("$0 spent")**, not as "empty" — strictly worse, because nothing signals anything is
  wrong. Landed by extending Read §1.1 (new paragraph + ❌ **Agent stats** example + a
  checklist line) and mirroring one line into the SKILL Quick review, citing
  `AgentUsage/index.tsx:46,98`.
- **Validated existing rules** (good ❌ instances to cite): Read §1.1 (gaps ①②③), Feedback
  §4.2 (gap ①, no retry), Feedback §4.1 (gap ⑥, antd `Spin`), Grow §5.3 (gap ⑤, dead-end
  config/metrics surface).
- **Good case candidate ✅:** the chart's height-exact skeleton (§2) is the numeric form of
  Feedback §4.1's "skeleton matches height" — noted as a ✅ example; not yet grafted into the
  rule text (§4.1 already states the principle).
- **Noted, not yet landed:** filter state → URL (gap ④) and comparison/export/drill-down
  class norms (gap ⑤) — captured here; promote to checklist items if a second dashboard
  surface repeats them.

## 5 — Pending: L2 visual + L3 dynamic

L1-only; verdicts a later pass should confirm or quantify on this surface:

- **L2 (visual)** — confirm gap ⑦ (does a sparse 3-bar chart actually read as a 30-day
  timeline?); confirm the `$0` cards vs a real value look identical enough to fool a user
  (gap ①); check the three-idiom loading (skeleton vs two spins, gap ⑥) side by side;
  narrow-width wrap of the two toolbar `Segmented`s (`index.tsx:64 wrap`).
- **L3 (dynamic)** —
  - Force the stats fetch offline to **confirm gap ① live** — that the page settles on `$0`
    with no error and no retry, not a skeleton.
  - Drive an agent with **zero** messages to **confirm gap ②** (what the true-empty state
    actually renders as).
  - **Measure CLS** across the loading→content swap; the chart skeleton predicts 0 for the
    chart, but the `Spin`→value swap on the cards and the table are unmeasured.
