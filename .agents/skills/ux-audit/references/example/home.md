# Worked example — Home page (首页) audit

A real run of this skill against the home landing (`src/routes/(main)/home`), 2026-07.
Use it as a **template for the output shape**, not as current-state truth (the code moves;
re-verify before citing). Surface = center column (agent greeting → composer → onboarding
banner → "上新" model chips → "简报" feed) plus the left sidebar (nav / 最近 / 助理).

**Layers run:** L1 (static / code) ✅ — everything below. L2 (visual) / L3 (dynamic +
CLS) ⏳ not yet run — see §5 for what they'd add. Verdicts about the render (e.g. "one
primary button") are L1 inferences here, pending L2 confirmation.

## 1 — Patterns in use

| Pattern (family)                           | Where                                                                                   | Rating | Note                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | ------ | ------------------------------------ |
| Global Navigation (nav)                    | left sidebar 搜索 / 首页 / 任务 / 资源                                                  | ✅     | persistent                           |
| Clear Entry Points (nav)                   | central composer as the one main door                                                   | ✅     | strong                               |
| Center Stage (layout)                      | greeting + input dominate the center                                                    | ✅     | textbook                             |
| Titled Sections / Card Stack (layout/data) | 简报 / 最近 / 助理；`BriefCard` list                                                    | ✅     |                                      |
| Accordion (layout)                         | 最近 / 助理 collapsible, reorderable, persisted                                         | ✅     |                                      |
| Overview + Detail (data)                   | card → `TopicChatDrawer`; 最近 → `AllRecentsDrawer`                                     | ✅     | preserves surface contract           |
| News / Activity Stream (data)              | 简报 feed, 10s poll                                                                     | ⚠️     | no Update Indicator / manual refresh |
| Input Prompt / Hints (input)               | daily hint used as placeholder                                                          | ⚠️     | dynamic + linkified placeholder      |
| Good / Smart Defaults (input)              | default inbox agent & model; **empty send falls back to the day's hint** (`useSend.ts`) | ✅     | highlight                            |
| Autocompletion (input)                     | `@` to assign another agent                                                             | ✅     |                                      |
| Button Groups (action)                     | 忽略 / 重试，已阅 (`BriefCardActions`)                                                  | ✅     |                                      |
| Smart Menu Items (action)                  | model switch gated by permission + tooltip (`StarterList`)                              | ✅     |                                      |
| Prominent "Done" Button (action)           | send button                                                                             | ✅     | one primary                          |
| Skeleton loading (feedback)                | every section + `NeuralNetworkLoading` revalidate                                       | ✅     | good coverage                        |
| Onboarding promo (growth)                  | connect-software / bot banners, dismissible + versioned                                 | ⚠️     | randomly rotated (see gap ⑥)         |
| Personable / delight                       | "开工咯 / 久等了" typewriter greeting                                                   | ✅     |                                      |

**Read:** navigation & layout are mature; defaults have real craft. Weakness clusters in
**Feedback (failure states)** and **Input (draft safety, placeholder)**.

## 2 — Strengths / good cases (don't regress)

Navigation & layout are mature and the defaults have real craft — these are the ✅ half of the
回灌 loop and the "don't regress" list for the next refactor of this page. Two land as **✅
examples in the `ux` checklists**:

- **✅ 亮点 — Empty-send falls back to the day's hint (→ landed as ux Read §1.1 ✅).** Sending
  an empty composer doesn't no-op — it falls back to the day's hint (`useSend.ts`), a
  Smart-Default that turns a dead action into a useful one instead of a silent nothing.
- **✅ 亮点 — Overview + Detail preserves the surface contract (→ landed as ux
  Preserve-the-surface-contract ✅).** Cards and 最近 open a portal /drawer (`TopicChatDrawer`,
  `AllRecentsDrawer`) rather than navigating away, so the home surface keeps its promise and the
  user never loses their place.
- **✅ 亮点 — Persisted, reorderable accordions.** 最近 / 助理 are collapsible, reorderable, and
  persisted, so the sidebar's shape survives reload and reflects how the user arranged it rather
  than resetting to a default order.
- **✅ 亮点 — Broad skeleton coverage.** Every section plus a `NeuralNetworkLoading` revalidate
  path has a skeleton, so the initial load reads as "loading" across the whole page rather than
  as scattered blank slots.

## 3 — Experience gaps (ranked)

**① No error/retry anywhere — ux §4.2** 🔴 The 简报 feed has only `!isInit` skeleton /
empty / success branches, **no error branch** (`src/features/DailyBrief/index.tsx:32`).
`isBriefsInit` flips true only on a successful fetch, so a failed request → **permanent
skeleton**. Same missing failure path in Recents, agent list, `AgentSelect` config, and
composer send (send errors only hit `console.error`). No Error Boundary on the page.

**② Composer draft not persisted — ux §2.1** 🔴 `inputMessage` lives in the chat store
(`src/store/chat/store.ts` — `createWithEqualityFn`, **no persist**), so a reload/crash on
the highest-traffic entry point vaporizes a typed task description.

**③ Empty vs failed ambiguity — ux Read §1.1** 🟠 Empty 简报 silently renders the
recommendations list or `null` (`DailyBrief/index.tsx:44`); "no todos", "load failed", and
"logged out" are indistinguishable, and there's no purpose-built empty state.

**④ Send has no in-progress/locked state — ux §3.1** 🟠 Send only disables the button;
"creating / navigating" has no explicit in-progress feedback, and failure is blank.

**⑤ Feed is an Activity Stream but has no Update Indicator / manual refresh — ux Read
§1.7** 🟡 10s polling with no "N new" signal, no manual refresh, and undefined behavior
when a poll lands mid-read.

**⑥ Onboarding banner is randomly rotated — Certainty** 🟡 `InputArea/index.tsx:62` picks
one undismissed banner at random per mount; the user can't form a stable model or get back
the one they saw.

**⑦ Dynamic, linkified content in the placeholder — Input Prompt trap** 🟡 The rotating
daily hint is used as the composer placeholder; `[label](url)` links inside it aren't
clickable, and a rotating hint "seen once" can't be retrieved.

**⑧ Agent list has no first-run empty state — ux Read §1.1** 🟡 Empty pinned-agents renders
a bare empty list, no "create your first agent" guidance.

## 4 — Skill feedback

- **Validated existing rules** (good ❌ examples to cite): §4.2 (gap ①, the permanent-
  skeleton), §2.1 (gap ②), Read §1.1 (gap ③).
- **Landed as new `ux` items** from this audit: Read **§1.7 Live / polling streams** (gap
  ⑤), Edit **§2.2 Stable input affordances** (gap ⑦), and a strengthened §4.2 note on the
  init-flag-gated-on-success failure mode (gap ①).
- **Good cases landed as ✅ examples:** empty-send → day's-hint fallback cited as the ✅
  Smart-Default beside Read §1.1 (a default that makes a dead action useful); card / 最近 →
  drawer-not-navigate cited as the ✅ example under _Preserve the surface contract_.
- **Noted, not yet landed:** predictable promo slots (gap ⑥) — captured here; promote to a
  checklist item if a second surface repeats it.

## 5 — Pending: L2 visual + L3 dynamic

This audit is L1-only; several verdicts are inferences a later pass should confirm or
quantify. What the other layers would add on this surface:

- **L2 (visual)** — confirm the composer send button truly reads as the single dominant
  control; check the rendered 简报 skeleton vs loaded card (height match, CLS symptom); the
  typewriter greeting's wrapping /truncation; narrow-width layout of the model chips row.
- **L3 (dynamic)** —
  - Force the 简报 fetch offline to **confirm gap ① live** (permanent skeleton, no retry).
  - Drive the send journey to **confirm gap ④** (is an in-progress/locked state shown; does
    success lead forward).
  - **Measure home CLS** across the loading→content swap (inject the layout-shift observer
    from [layer-3-dynamic.md](layer-3-dynamic.md)) and report the number + verdict — the
    skeleton coverage looks good in code, but only the metric proves it.
