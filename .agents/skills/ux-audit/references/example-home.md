# Worked example — Home page (首页) audit

A real run of this skill against the home landing (`src/routes/(main)/home`), 2026-07.
Use it as a **template for the output shape**, not as current-state truth (the code moves;
re-verify before citing). Surface = center column (agent greeting → composer → onboarding
banner → "上新" model chips → "简报" feed) plus the left sidebar (nav / 最近 / 助理).

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

## 2 — Experience gaps (ranked)

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

## 3 — Skill feedback

- **Validated existing rules** (good ❌ examples to cite): §4.2 (gap ①, the permanent-
  skeleton), §2.1 (gap ②), Read §1.1 (gap ③).
- **Landed as new `ux` items** from this audit: Read **§1.7 Live / polling streams** (gap
  ⑤), Edit **§2.2 Stable input affordances** (gap ⑦), and a strengthened §4.2 note on the
  init-flag-gated-on-success failure mode (gap ①).
- **Noted, not yet landed:** predictable promo slots (gap ⑥) — captured here; promote to a
  checklist item if a second surface repeats it.
