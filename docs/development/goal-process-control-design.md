# Goal detail — process control for long-horizon execution

**Date:** 2026-08-26
**Status:** aligning — round 3 (frontier as a Task-style list on the Task-page skeleton, sidebar list added; rounds 1–2 rejected/refined by the user)
**Scope:** the Goal detail page (`/agent/:aid/goal/:goalId`) and the two places that feed into it (Goal list, Home inbox rail), redesigned as a **process-control surface** for the long-horizon Goal runtime (Goal Graph + Work recovery + Acceptance + decision gates). Out of scope: Goal creation wizard, the Acceptance workspace itself, a full-screen graph editor, mobile.
**Prototype:** `docs/development/goal-process-control-prototype.html` (three-pane app shell: sidebar list · NavHeader · detail column; 9 scenarios)
**Evidence:** the two exploration topics (`tpc_1p4dwDmUPsnN`, `tpc_XUh2GbVp3UVM`), the merged runtime PR #18670, domain types/services under `packages/types/src/goal.ts`, `apps/server/src/services/goal/*`, `apps/server/src/services/verify/*`, the shipped UI under `src/features/AgentGoals/*`, and `docs/development/agent-goals-*.md`.

---

## 0. The flow, in time order

What actually happens to one Goal from creation to closure, step by step, with what the user sees and can do at each step. State names are in parentheses only as provenance; the surface never leads with them.

| #   | What happens (system)                                                                                                                                                                                                         | What the user sees / can do                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Create.** Goal row + requirement + budgets; the graph is seeded with a Problem node and the initial Work nodes (`goal.create`, or `/goal` in chat which also creates the carrier Task). Nothing is dispatched. (`planning`) | Goal appears in the left list under 排队中. Detail: "已就绪，还没有开始"; frontier lists the Works that have no dependencies as 可以开始. Actions: 开始执行，添加 Work, 预算.                                     |
| 2   | **First advance.** The coordinator picks the highest-priority Work whose `depends_on` are resolved, creates its owner Task + Work-scoped Acceptance, and starts the Task (`tick`, `running`).                                 | The row moves to 进行中 with the owner Task inlined (agent, attempt 1, last activity). The graph shows the Work node thick-stroked with the Task line inside.                                                     |
| 3   | **Execute.** The builder agent works inside the Task topic; the runtime refreshes the operation lease every 90 s.                                                                                                             | Last tool line + last-activity age on the row. "给下一次尝试的说明" is always available and is carried into the _next_ attempt, not the running one.                                                              |
| 4   | **Submit evidence.** When the builder's run ends, the server registers its final delivery as evidence for the Work-scoped Acceptance (heterogeneous builders hand off server-side).                                           | Row reads 举证中 briefly; nothing to do.                                                                                                                                                                          |
| 5   | **Verify.** An independent native verifier judges the evidence against the Work contract (`verifying`).                                                                                                                       | Row reads 验证中 with the verifier as the actor. Nothing to do.                                                                                                                                                   |
| 6a  | **Pass → Finding.** Task completes, the Work version is pinned, a Finding is created from the handoff, the Work resolves, and the frontier is recomputed: downstream Works unblock.                                           | Row leaves the frontier; a new Finding appears in 最近结论 and as a green node; the next Work shows up as 可以开始 → 进行中 on the next advance.                                                                  |
| 6b  | **Fail → automatic recovery.** If attempts remain and budget remains, a fresh attempt starts in a new topic carrying the verifier's feedback (`WorkRecoveryCoordinator: continued`).                                          | Row stays 进行中 as 第 N+1 次尝试；the previous attempt is in the row's ledger with the verifier's reason. **No human involvement** (the user's rule: intervene only for key decisions).                          |
| 6c  | **Lost contact.** No lease refresh for `operationLeaseTimeoutMs`: the next advance marks the attempt `abandoned/lease_expired`, charges its cost, and asks recovery for a replacement.                                        | Row flips to 失联 with the age; the node goes dotted red. The user may 立即回收并重开 (an advance) or wait.                                                                                                       |
| 7   | **Gate.** Attempts exhausted (or the terminal Work failed): a Decision node with options + recommendation opens; the Work waits; the Goal is 等你决定 (`review`, `waiting_human`).                                            | The decision row is **first in the frontier list**, expanded: question, why, attempts/cost, options with consequences, recommended, optional guidance → 决定. Left list shows the Goal under 需要你 with a badge. |
| 8   | **Decide.** `retry` → the Work gets another attempt (back to step 2 for that Work); `retire` → the Work is abandoned and the Goal continues with what is left; on the terminal Work, `fail` → Goal failed.                    | The decision row collapses into the graph as a resolved orange node; the Work row returns to 进行中 or disappears.                                                                                                |
| 9   | **Budget boundary.** Cost or attempt cap reached at any advance: the Goal pauses (`paused`, no reason recorded).                                                                                                              | Frontier's first row is 费用预算用完 with the numbers and 追加预算并继续 (= setBudget + resume). Nothing else moves until then.                                                                                   |
| 10  | **Steer.** At any time the user (or an agent) can add a Work off a Finding (`addNode` + `leads_to` edge) or add a dependency.                                                                                                 | From a Finding's node detail: 基于这个结论开一条 Work. The new Work enters 可以开始 or 等待中.                                                                                                                    |
| 11  | **All Works terminal → Goal acceptance.** The coordinator synthesizes one last Work, "Complete full Goal acceptance", with the whole requirement as its contract; steps 2–6 repeat for it.                                    | The row 完成整体 Goal 验收 becomes the only frontier item; its verifier verdict lists the goal-level checks.                                                                                                      |
| 12  | **Close.** Task-carried: verifier pass parks the Goal and a human `accept` makes it `achieved`. Graph: the coordinator sets `achieved` itself when the terminal Work resolves. (D1 proposes unifying on the human accept.)    | Frontier's single row is 验收通过 p/q，等你确认 → 确认完成 / 还不够，再来一轮 (with feedback). After that: "没有需要推进的了・已达成", left list moves it to 已完成.                                              |
| —   | **Pause / resume** can interleave anywhere: pause stops _new_ attempts only.                                                                                                                                                  | 暂停 confirm says exactly that; 继续 returns to whatever step the Goal was at.                                                                                                                                    |

Two honest gaps in this timeline today: between any two steps a **Graph goal only advances when a client calls `tick`** (D2), and step 7 **does not notify** the user for Graph goals (no brief).

---

## 1. What the business actually models

Two execution models share one `goals` row and one status enum:

| Carrier                    | How it advances                                                                                                    | Who closes it                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Task-carried** (`/goal`) | Event-driven: task run → verifier settles → next round spawns or the goal parks for review                         | **Human.** Verifier `passed` parks the task, sets goal `review`, raises one decision brief; `accept` → `achieved`     |
| **Graph** (`standalone`)   | A deterministic coordinator `tick()`; **the only caller is TRPC `goal.tick`**, i.e. someone must run `lh goal run` | **System.** When the terminal "Complete full Goal acceptance" Work resolves, tick sets `achieved` with no human event |

### Concepts

- **Goal** — the contract: title, `requirement` (what counts as done), budgets (`maxRounds`, `maxTotalCost`), recovery policy (`maxAttemptsPerWork`, `maxStepsPerRun`, `operationLeaseTimeoutMs`).
- **Work** — one delegated unit of execution, bound 1:1 to a Task. Only Work gets executed; Problem / Finding / Decision nodes are cognition, not execution.
- **Attempt** — one task topic run of a Work. A Work may have several attempts; each ends in a verifier verdict, a lease expiry, or an error.
- **Finding** — what the system now believes after a Work resolved; created automatically from the attempt handoff. Findings are the material for evolving the graph (`leads_to` → new Work).
- **Acceptance** — the proof contract. One per Work (scoped to that Work) and one for the whole Goal (the terminal Work). A **verifier verdict is advice**; `accept` / `reject` are the human events.
- **Decision gate** — a durable question addressed to a human (`authority: user`), with `options[]`, a `recommendedOptionId`, and a `resolution`. Today the generator only emits `retry | retire` (or `retry | fail` on the terminal Work); the schema supports arbitrary options.
- **Lease** — liveness of an attempt. Runtime refreshes it every 90 s; after `operationLeaseTimeoutMs` (default 5 min) the next tick reclaims the attempt as `abandoned / lease_expired` and asks the recovery coordinator for a replacement.

### States and what each obliges someone to do (`P-01`)

| Goal status | Business meaning                                                                                                           | Obliges                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `planning`  | Contract exists, nothing dispatched                                                                                        | Nobody — except that a **Graph goal will never move unless a client ticks it**                                                           |
| `running`   | An attempt is executing                                                                                                    | Nobody. The user may watch                                                                                                               |
| `verifying` | A delivery is being judged                                                                                                 | Nobody                                                                                                                                   |
| `review`    | **A human must act**: a decision gate is `pending`, or a delivery is `delivered` and awaits accept/reject                  | **The user.** This is the queue state; an agent is blocked on you right now                                                              |
| `paused`    | Coordination stopped. Three causes: (a) the user asked, (b) round/cost budget exhausted, (c) verify errored / spawn failed | (a) nothing until you're ready; (b) **raise the budget or give up**; (c) **fix and retry**. The domain does not record which one applies |
| `achieved`  | The Goal-level acceptance was satisfied                                                                                    | Nobody — read the outcome                                                                                                                |
| `failed`    | Terminal acceptance retired / verify errored past budget                                                                   | Nobody — read why                                                                                                                        |
| `canceled`  | Terminal by human                                                                                                          | Nobody                                                                                                                                   |

Work node status: `proposed` (queued, may be blocked by `depends_on`), `active` (attempt running or about to), `waiting` (a gate is open on it), `resolved`, `rejected`, `retired`.

### Actions and the business event each produces (`P-02`)

| Action                          | What the business does next                                                                                                                               | Exists?                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Pause                           | No **new** attempt will start. **The attempt currently running keeps running until it ends** — pause only flips goal status; nothing aborts the operation | ✅ `goal.pause` (unconditional — will even "pause" an achieved goal)        |
| Resume                          | Coordination continues → `running`, or `review` if a gate is still pending                                                                                | ✅ `goal.resume`                                                            |
| Decide → `retry`                | That Work gets attempt N+1 (task back to `backlog`, node `active`, goal `running`)                                                                        | ✅ `goal.decide`                                                            |
| Decide → `retire`               | That Work is abandoned; the goal keeps going with other Work. On the terminal Work → goal `failed`                                                        | ✅                                                                          |
| Set budget                      | Caps change. **Does not resume by itself** — a budget-paused goal needs `setBudget` + `resume`                                                            | ✅ `goal.setBudget`                                                         |
| Accept delivery                 | Closes the lifecycle: task completed, goal `achieved`                                                                                                     | ✅ `acceptance.accept` (task-carried)                                       |
| Reject delivery with comment    | **Re-tasks**: a new round starts with the comment as input, if budget remains; otherwise the goal pauses                                                  | ✅ `acceptance.reject`                                                      |
| Add Work / edge                 | Steers exploration — a new Work enters the frontier                                                                                                       | ✅ `goal.addNode` / `goal.addEdge` (CLI only)                               |
| Comment on the Work's task      | Guidance carried into the next attempt                                                                                                                    | ✅ task comments                                                            |
| Tick                            | Advance one coordinator step                                                                                                                              | ✅ `goal.tick`                                                              |
| Cancel a Graph goal             | —                                                                                                                                                         | ❌ no procedure (`task.updateStatus` only reaches task-carried goals)       |
| Edit a Graph goal's requirement | —                                                                                                                                                         | ❌ `goals.requirement` has no update path                                   |
| Stop the running attempt        | —                                                                                                                                                         | ❌ no AbortSignal wiring; an in-flight model/tool call is never interrupted |

### Concepts the business does not have (`P-06`)

- **A pause reason.** `goals` has no column; the cause is only in the tick's return message. The UI cannot honestly say "paused because budget ran out" without deriving it from spend vs. cap.
- **An unattended driver for Graph goals.** No scheduler, workflow, or signal enqueues `tick`. "7×24" is only true while a CLI `run` loop is alive.
- **Notification for Graph gates.** Task-carried failures raise a brief; `openFailureDecision` for Graph goals raises nothing.
- **Visibility of Graph goals.** `GoalModel.list` filters `subjectType = 'task'`; standalone goals are unreachable from the SPA.
- **Progress inside an attempt** (e.g. 2750 / 5000 iterations). Only "running" exists.
- **Semantic gate options.** Gates are always `retry | retire`; the exploration topic (#2710) already named this as the biggest gate weakness.
- **Partial / inconclusive / blocked terminal outcomes.** Only `achieved | failed | canceled`.

---

## 2. User view model

### Circumstance and job

**Observed** (topic `tpc_XUh2GbVp3UVM`): the user delegated a \~1 h nanoGPT training Goal and came back **six times** asking "现在呢 / 再看下当前进展 / 我可以怎么查看这个进展 / 那我现在能看到这个运行状态码". They challenged a fake-progress signal ("为什么样本 goal 都是 achieved?"), challenged a low bar ("为什么 Acceptance 生成的阀门比较低？"), asked _why_ it stalled, and dismissed one flagged issue ("这个不是问题，忽略吧"). They resumed with "你能继续跑吗 / 继续".

**Reported** (topic `tpc_1p4dwDmUPsnN` #377): "人介入的环节应该要足够少，最好只在需要做关键决策时才介入，其他情况由系统自动恢复和推进"; a good gate is "证据 + 解释 + 有限选项 + 每项代价 + 推荐"; the first screen must answer "走到哪了、系统当前相信什么、哪件事需要我决定、预算和风险如何"; and "不能因为底层是树，就把业务模型直接做成首页信息架构".

**Job statement (inferred):**

> When I open a Goal I delegated hours ago, I need to know in five seconds whether it is still moving, how far it got, whether it is blocked on me, and whether it is spending sensibly — and if it _is_ blocked on me, decide with enough evidence without leaving the page.

### Lookup objects and attached proof (`P-14`)

1. "I came here to find **what can move next** — the frontier: every node that can change state under current conditions (a decision waiting on me, a Work being executed, a Work whose dependencies are met)."
2. "For each frontier item I need, without another click: **why it is on the frontier** (needs me / running / ready), **who is executing it and when it last did something**, **attempt N of M and cost**, and — for a decision — **the evidence, the options, what each costs, and the recommendation**."
3. "I use **the exploration graph** to see what the system currently believes and which paths it is on; **attempt ledgers, verifier reasoning, evidence, topics and the event ledger** only to investigate."

The frontier is not "all unfinished nodes" — it is the candidate set the coordinator itself selects from (`depends_on` resolved, no open gate, non-terminal). Nodes waiting on other nodes are folded, not listed.

### First scan — answered without a click

1. Does it need me? — the **需要你** group at the top of the frontier, or none.
2. What is moving right now, and is it alive? — **进行中** items with owner Task + last-activity age (a spinner alone is what lied in the nanoGPT run).
3. What comes next and why? — **可以开始** items, blocked items folded with their blocker's name.
4. What does the system currently believe? — **最近结论** (latest Findings) beside the graph, where the same nodes are highlighted.
5. Cost and progress — header chips: Work n/m, checks p/q, attempts a/b, spend $x/$y.

### Secondary dimensions

Full graph (zoom), per-node detail (attempts, evidence, edges "在图里的位置"), chronology (activity ledger), contract text. All one click away, none on the first scan.

### Evidence and confidence

| Claim                                                     | Kind     | Confidence                                    |
| --------------------------------------------------------- | -------- | --------------------------------------------- |
| Users poll for progress and distrust a bare spinner       | observed | high (one power user; validate with 2–3 more) |
| Users want gates to be rare and well-argued               | reported | high                                          |
| "Ordinary" users read Work rows, not graph nodes          | inferred | medium — the only user evidence is the author |
| Users expect to raise budget in place rather than via CLI | inferred | medium                                        |

---

## 3. Diagnosis — structural errors

1. **The queue state has no counter.** The domain models `review` as "an agent is blocked on you" (gate pending, or delivery awaiting accept). The Goal detail page exposes _Copy ID · Copy link · Delete_. A pending decision gate is invisible in the product; for Graph goals it is invisible in the list, invisible on Home, and never notified. The surface represents a report; the implementation is a loop that stops and waits for you (`P-04`, `P-01`).
2. **`paused` and `review` collapse into one glyph** (`goalStatusToTaskStatus` maps both to the same visual), and `paused` itself hides three different obligations. The most urgent case — budget exhausted — looks identical to "I paused it myself" (`P-01`).
3. **The page is organized by the execution model.** Detail = Task tree + last 10 TopicCards + a read-only criteria list. The user's lookup object (Work) and its proof (latest outcome, attempts, cost) are not rows on the page (`P-13`, `P-14`).
4. **Liveness is not represented.** The nanoGPT run had goal `running`, task `running`, and the executing operation gone for an hour. A `running` spinner with no "last activity 47 min ago" is a false claim; the domain already has operation heartbeats and leases (`P-04`).
5. **Two different closers.** Task-carried goals need a human `accept` to become `achieved`; Graph goals close themselves. A user cannot form one expectation of "who says it's done" (`P-12`).
6. **Round 1 of this spec repeated error 3 in a new costume.** A Work _list_ is still an execution-model projection; the user's mental model is the exploration graph, and the retrieval object is its frontier. A flat list hides why a node is next, what it depends on, and what the system currently believes (`P-14`, mental model).
7. **Controls that exist name the wrong effect.** "Pause" reads as "stop"; the business event is "start nothing new, let the current attempt finish". "Set budget" reads as "continue"; it does not resume.

---

## 4. Principles (each with the alternative it rejects)

- **Frontier first.** The first screen is the candidate set that can move now, grouped by what it asks of the user: 需要你 → 进行中 → 可以开始；everything waiting is folded. _Rejected:_ a Work list ordered by status (round 1) and a chronological feed — both hide _why this, now_.
- **The graph is the mental model, not a drill-down.** It sits beside the frontier, always visible, with frontier nodes emphasized and the same hover/selection as the cards. _Rejected:_ graph as a secondary tab (round 1) and graph as the only view (nobody can act from a picture).
- **Kind is color, state is stroke.** Problem / Work / Finding / Decision keep stable colors (the user's explicit ask); running / gate / blocked / stale are stroke weight and dash, never fill. _Rejected:_ one `active` visual for "just created", "selected for synthesis" and "running" (the correction from the first graph mock).
- **Owner Task is inline in its Work node**, never a separate node. _Rejected:_ Task-as-node.
- **Liveness over status label.** Every running item shows last-activity age; past the lease timeout it becomes a 需要你 card and a dashed red node. _Rejected:_ a spinner on `running`.
- **A gate is evidence + options + consequences + a recommendation, resolved in place.** _Rejected:_ "open the Acceptance page" / "use the CLI".
- **Findings are the system's beliefs and get their own place** (最近结论), each traceable to the Work that produced it and clickable into the graph. _Rejected:_ burying Findings inside Work rows.
- **Controls say what they really do.** "Pause — no new attempts; the current one finishes." "Add budget and continue." _Rejected:_ generic Pause / Stop / Save.
- **Plain words for states.** `proposed`+deps-met → 可以开始；`proposed`+blocked → 等待「X」; `waiting` → 等你决定；`lease_expired` → 失联，等待回收. _Rejected:_ exposing node/acceptance enums.

---

## 5. Information architecture — on the Task page skeleton

The Goal pages reuse the Task pages' shell verbatim so the two surfaces read as one family: global `NavPanel` / `AgentSidebar` on the left (NavItem accordion), `NavHeader` (44 px: panel toggle · breadcrumb · actions · right-panel toggle), a centered `WideScreenContainer` reading column (`CONVERSATION_MIN_WIDTH` = 960), and the optional right `AgentTaskManager` panel. Column order mirrors `TaskDetailPage` (title → run action + properties → body sections → activities). The page is single-pane list → detail, not master-detail.

```
┌ AgentSidebar ─────────┬ NavHeader  [◧] 所有目标 › Agent › GOAL-12 title            [⋯][◨] ┐
│ 对话 / 任务 / 目标 ●   ├────────────────────────────────────────────────────────────────┤
│ 目标            [🔍][+]│  Title (TaskDetailTitleInput)                                   │
│ ▾ 需要你 2            │  [暂停|继续|开始执行]  已进行 1h18m      状态  等你决定 · 3 分钟    │
│   ⚠ nanoGPT …     (1) │  requirement excerpt                    费用  $1.84 / $5.00 ⚙   │
│   ⚠ Search1API …  (1) │                                         尝试  4 / 10 · 单项 3     │
│ ▾ 进行中 2            │                                         验收  0 / 3             │
│   ◌ 回收站 Phase 2  1m │                                         负责  Coding Agent      │
│   ◌ Device quota   8m │  现在能推进的 · 2 项 · 1 项需要你                    [+ 添加 Work] │
│ ▾ 排队中 1            │  ┌ ▾ ● 训练已失败 2 次，怎么继续？  等你决定   W-3 · 2/3 $1.52 3m ┐│
│   ○ 带教式创建原型  2h │  │   why · [再试一次 推荐] [放弃] · 说明 ▭  [再试一次]            ││
│ ▸ 已完成 3            │  ├ ▸ ● W-4 写训练复现说明        可以开始                          ┤│
│                       │  └ ◷ 2 项在等待依赖：采样 · 整体验收                       显示 ┘│
│                       │  探索图  ■问题 ■Work ■结论 ■决策 · 粗边=能推进 · 虚线=等待   [⤢] │
│                       │  (layered DAG, frontier emphasized, click → 节点详情)            │
│                       │  ▾ 结论 3  ·  ▸ 目标与验收标准  ·  ▾ 活动 12 (comment input first)│
└───────────────────────┴────────────────────────────────────────────────────────────────┘
```

### Left list — `AgentSidebar › 目标` (mirrors `AgentSidebar/Task`)

Business concept: the agent's Goals grouped by what they ask of the user, same shape as the sidebar task groups (`needsInput / running / backlog`).

| Group  | Membership                                                                                                           | Row                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 需要你 | frontier has a `rank 0` item: pending user decision, goal-level acceptance delivered, budget exhausted, lost contact | ⚠ glyph・title・status sentence ("等你决定・已等待 3 分钟")・**orange count badge** (number of items waiting on you) |
| 进行中 | `running` / `verifying` with a live attempt                                                                          | ◌ spinner glyph・title・"进行中・第 N 次・最近动作 2 分钟前"・age                                                    |
| 排队中 | `planning`                                                                                                           | ○ glyph・title・"已就绪，还没有开始"・age                                                                            |
| 已完成 | `achieved` / `failed` / `canceled` — **collapsed by default**                                                        | ✓ / ✗ glyph · title · outcome · age                                                                                  |

Group header carries the count; a collapsed 需要你 keeps its badge visible. Search + create live in the section header (as the task sidebar's `[→]` view-all does). Row = `NavItem` with `titlePrefix` glyph and a one-line `description` slot; active row = `NavItem active`. The full-page Goal list (`/agent/:aid/goals`) reuses `TaskList` + `AgentTaskItem` field order — glyph · id · title · frontier summary · assignee · age — with the same group config; it is not re-specified here.

### Detail column — block by block

1. **Title** — `TaskDetailTitleInput` (borderless, autosave).
2. **Run action + properties** (the `TaskDetailRunPauseAction` / `TaskProperties` row). Left: **开始执行 / 暂停 / 继续 / 重新打开 (❌)** with the honest pause confirm, elapsed, requirement excerpt. Right, labelled rows like `TaskProperties`: 状态 (plain sentence + liveness)・费用 spent/cap (click → budget popover = `setBudget`)・尝试 used/cap・单项上限・验收 p/q・负责 agent.
3. **现在能推进的 — the frontier list** (the body's first section; the `TaskSubtasks` slot). A `TaskList`-styled block: dashed-divided rows, 1–6 items, ordered by what they ask of the user:
   - rows that **need you** come first and are **expanded by default**: decision gate (why・options with consequences・recommended・optional guidance・primary button), goal-level delivery (checks・确认完成 / 还不够→feedback), budget exhausted (追加预算并继续), lost contact (立即回收并重开);
   - **进行中** rows: kind dot · `W-n`・title・"进行中・第 N 次尝试"・right meta `T-94 · Kimi Code · 尝试 2/3 · $1.52 · 2m`; expand → last tool line, attempt ledger, 给下一次尝试的说明；
   - **可以开始** rows: "依赖已满足；下一次推进开始"; expand → 现在开始 (⚠️ serial coordinator);
   - footer: **"N 项在等待依赖：…"** folded, toggles dimmed blocked rows with their blocker.
     Header shows `N 项 · M 项需要你` and `+ 添加 Work`. Empty: `planning` → one row "Goal 已就绪，还没有开始" with 开始执行；`achieved` → "没有需要推进的了".
4. **探索图** — full column width, legend, zoom-to-wide toggle; node click → **节点详情** block beneath (state・body・attempt ledger・在图里的位置・for a Finding: 基于这个结论开一条 Work). Visual grammar as in §4.
5. **结论** — Findings list (dot・title・来自「Work」・age), open by default when non-empty; hover/click syncs with the graph.
6. **目标与验收标准** — collapsed; requirement, goal-level checks, budget/recovery values (edit ❌ for Graph goals).
7. **活动** — the `TaskActivities` slot: comment input on top (a task comment, carried into later attempts), then the merged ledger (attempt boundaries, verifier verdicts, findings, decisions, human actions).

The right `AgentTaskManager` panel is mounted by the same toggle as on Task pages (conversation with the responsible agent); not re-specified.

---

## 6. Scope — what does the business already support?

| Bucket | Capability                                                                                                                 | Note                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ✅     | Pause / Resume / Set budget / Decide / Tick                                                                                | TRPC exists, SPA never calls it                                                             |
| ✅     | Graph snapshot: nodes, edges, decisions (options, recommendation), events, work versions                                   | `goal.graph`                                                                                |
| ✅     | Accept / Reject-with-comment on the goal-level acceptance                                                                  | verify store already used by `GoalAcceptance`                                               |
| ✅     | Task comments as guidance for the next attempt                                                                             |                                                                                             |
| ⚠️     | Standalone (Graph) goals in the list                                                                                       | drop the `subjectType = 'task'` filter, or add a second query; visibility rule needs a home |
| ⚠️     | Last-activity age / lease staleness per running Work                                                                       | operation `lastHeartbeatAt` + `operationLeaseTimeoutMs`; needs projecting into the snapshot |
| ⚠️     | Attempt ledger per Work (topics with handoff, verdicts, cost)                                                              | `taskTopicModel.findWithHandoffByTaskIds` is what tick already reads                        |
| ⚠️     | Frontier computation on the server (today it is internal to `tick`; the UI needs it as a read, e.g. in the graph snapshot) | pure projection of existing state                                                           |
| ⚠️     | Add Work / Add edge from the UI                                                                                            | procedures exist                                                                            |
| ⚠️     | Budget-exhausted detection                                                                                                 | derive from spend ≥ cap; no reason field                                                    |
| ⚠️     | Brief / inbox item for a Graph gate                                                                                        | brief model exists; `openFailureDecision` never raises one                                  |
| ❌     | **Unattended driver for Graph goals** (enqueue `tick` on task completion, verify settle, decide, resume + periodic sweep)  | without it the UI must not claim "running unattended"                                       |
| ❌     | Pause reason on the goal                                                                                                   | small column + event                                                                        |
| ❌     | Cancel / edit requirement for Graph goals                                                                                  | two procedures                                                                              |
| ❌     | Stop the current attempt                                                                                                   | AbortSignal wiring through the runtime; known TODO                                          |
| ❌     | Semantic gate options                                                                                                      | generator work; UI renders `options[]` generically today                                    |
| ❌     | Progress within an attempt                                                                                                 | new concept; would need a runtime progress channel                                          |
| ❌     | Partial / inconclusive terminal states                                                                                     | domain expansion                                                                            |

**Recommended coherent slice (v1):** blocks 0–3 and the list facets, on ✅ + the four cheap ⚠️ items (list filter, staleness projection, attempt ledger, brief on Graph gate). This completes the job — _see it moving, see how far, act when blocked, control spend_ — for both carriers.

**Does not, and why:** the unattended driver (❌) is not UI work but it is the difference between a control panel and a dashboard for Graph goals; ship the UI with the honest state "Waiting to be advanced" until it lands. Cancel / edit-requirement for Graph goals are two small procedures and should ride along or immediately after. Stop-current-attempt, semantic gates, in-attempt progress, and extra terminal states are named here so they are not read as oversights (`P-11`).

---

## 7. Red lines

- **A Graph goal does not advance without a client ticking it.** Any "unattended" wording in the UI is false until a server-side driver exists.
- **The verifier's verdict is not acceptance.** No UI may render `passed` as "Done"; only a human `accept` (task-carried) or the terminal Work resolving (Graph) is terminal — and the two should be unified (D1).
- **Pause does not stop the running attempt.** The confirm copy must say so.
- **No "progress %" inside an attempt** — the concept does not exist; show last-activity age instead.

---

## 8. Reality-check log

| Assumption                                     | What is true                                                                                                                    | Model                                                                          | Verdict        | Pattern |     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------- | ------- | --- |
| The Goal page is a progress report             | The business models `review` as "a human must act"; the surface has no place to act                                             | implementation                                                                 | overturned     | P-04    |     |
| `paused` means the user paused it              | It also means "budget exhausted" and "verify errored"; the most urgent case is undistinguishable                                | implementation                                                                 | overturned     | P-01    |     |
| `running` means it is working                  | Goal, task, and operation liveness are three facts; the nanoGPT run was `running` for an hour with no executor                  | implementation                                                                 | overturned     | P-04    |     |
| Goals become achieved when the verifier passes | Task-carried: human `accept` closes. Graph: the coordinator closes. Verifier output is advice in one and the event in the other | implementation                                                                 | refined        | P-12    |     |
| Pause stops the agent                          | Pause only stops scheduling; the running attempt finishes                                                                       | implementation                                                                 | overturned     | P-02    |     |
| Raising the budget resumes the goal            | `setBudget` and `resume` are separate events                                                                                    | implementation                                                                 | overturned     | P-02    |     |
| Graph goals run 7×24 once created              | Only TRPC `tick` advances them; nobody calls it server-side                                                                     | implementation                                                                 | overturned     | P-06    |     |
| A gate notifies the user                       | Only task-carried failures raise a brief; Graph gates raise nothing                                                             | implementation                                                                 | overturned     | P-04    |     |
| All goals appear in the list                   | `list` filters to task-carried goals                                                                                            | implementation                                                                 | overturned     | P-04    |     |
| Gates offer meaningful choices                 | Always \`retry                                                                                                                  | retire\`; the schema supports richer options, the generator does not emit them | implementation | refined | —   |
| Users want the graph                           | The user repeatedly asked for progress and liveness; the graph was explicitly demoted to an exploration view by the user        | mental                                                                         | confirmed      | P-14    |     |
| Users want to be asked                         | The user wants to be asked rarely and with evidence + options + cost + recommendation                                           | mental                                                                         | confirmed      | —       |     |

**Coverage:** domain types and enums, goal/verify/recovery services, TRPC and CLI surfaces, the shipped SPA (routes, store, components), three design docs, and both exploration topics. Not checked: production Goal data on app.lobehub.com, any user other than the author, Linear tickets (connector not authorized in this session). Low-confidence: the "ordinary user reads Work rows" claim rests on one power user; the exact staleness threshold copy.

**Pattern candidates:** one — _"A running state must carry its own liveness evidence; a status inherited from a parent (goal ← task ← operation) can be true while the executor is gone."_ Generalizes beyond Goal (tasks, hetero agents, device connectors). Anchor: Cooper's represented-vs-implementation model. Not appended; proposed for review.

---

## 9. Open decisions

**D1 — Who closes a Goal?** Recommend: unify on the task-carried rule — the goal-level acceptance reaching `delivered` puts the goal in `review`, and a human `accept` makes it `achieved`; per-Work acceptance stays automatic. Reason: DESIGN.md's stance ("the user owns the judgment and the final decision"), and the "low bar" incident shows verdicts are advice. Consequence: one more human touch per Goal — acceptable because it is the _one_ key decision (#377). Alternative if the user prefers zero-touch: auto-achieve with a visible "Reopen" for N days.

**D2 — Unattended driver for Graph goals.** Recommend: build it before the UI claims anything about running unattended; enqueue `tick` on task completion, verify settle, decide, resume, and a periodic sweep for `running/planning` goals with no live attempt. Until then the UI shows "Waiting to be advanced" with an explicit "Advance" (tick) button — honest, not pretty.

**D3 — Pause semantics.** Recommend v1 keeps the domain's meaning and says it plainly; add "Stop current attempt" only once AbortSignal is wired.

**D4 — Gate options.** Recommend the UI render `options[]` + `recommendedOptionId` generically now, so semantic options from the generator light up without UI change.

**D5 — Graph on the first screen.** Decided by the user: the frontier list is the key display and the full graph sits directly under it. Remaining question is layout at scale (collapse resolved subtrees vs. paginate lanes) — recommend collapse-to-badge, validated in the next prototype round with a 30-node graph.
