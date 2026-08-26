# Goal detail — process control for long-horizon execution

**Date:** 2026-08-26
**Status:** aligning — round 2 (frontier-first; round 1's Work-list IA was rejected by the user)
**Scope:** the Goal detail page (`/agent/:aid/goal/:goalId`) and the two places that feed into it (Goal list, Home inbox rail), redesigned as a **process-control surface** for the long-horizon Goal runtime (Goal Graph + Work recovery + Acceptance + decision gates). Out of scope: Goal creation wizard, the Acceptance workspace itself, a full-screen graph editor, mobile.
**Prototype:** `docs/development/goal-process-control-prototype.html`
**Evidence:** the two exploration topics (`tpc_1p4dwDmUPsnN`, `tpc_XUh2GbVp3UVM`), the merged runtime PR #18670, domain types/services under `packages/types/src/goal.ts`, `apps/server/src/services/goal/*`, `apps/server/src/services/verify/*`, the shipped UI under `src/features/AgentGoals/*`, and `docs/development/agent-goals-*.md`.

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

## 5. Information architecture — Goal detail

Two columns on desktop (frontier ≈ 400 px, graph fills the rest); stacked frontier-then-graph under 960 px. Each block names its business concept, its empty state, and how it holds at 100×.

### 0 · Header

Title · **status sentence in plain words + last-activity age** ("运行中・最近动作 2 分钟前", "等你决定・已等待 3 分钟", "已暂停・费用预算用完", "已达成・20 分钟前")・elapsed・four chips (Work n/m・验收 p/q・尝试 a/b・$x/$y, the spend chip turns warning at the cap)・controls **暂停 / 继续**, **预算** (popover: cost cap, attempt cap, attempts-per-Work → `setBudget`), overflow (添加 Work ⚠️, 编辑目标 ❌, 复制链接，结束 ❌, 删除).

### 1・Frontier column — 现在能推进的

Business concept: the coordinator's candidate set (`tick` step 3) plus pending decisions (`tick` step 2).

| Group    | Members                                                                                     | Card contract                                                                                                                                                        | Actions (business event)                                                                                   |
| -------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 需要你   | pending user decision · goal-level acceptance `delivered` · budget exhausted · lost contact | Decision: question, the Work it concerns, attempts N/M, cost, why (verifier reason), `options[]` each with a consequence line, recommended marked, optional guidance | `goal.decide` · `acceptance.accept` / `reject(comment)` · `setBudget`+`resume` composed · `tick` (reclaim) |
| 进行中   | Work `active`                                                                               | title・进行中・第 N 次尝试・owner Task id + agent・last-activity age・last tool line・expand → attempt ledger, "给下一次尝试的说明"                                  | task comment (guidance) · open run                                                                         |
| 可以开始 | Work `proposed` with all `depends_on` resolved                                              | title・"依赖已满足；下一次推进开始"・expand → 现在开始                                                                                                               | `tick` / `runTask` (⚠️ coordinator is serial today — parallel start is tagged NEW)                         |
| 等待中   | Work `proposed` with an unresolved dependency — **folded**, one line naming the blocker     | —                                                                                                                                                                    | hover → highlight in graph                                                                                 |
| 最近结论 | latest Findings                                                                             | title・来自「Work」・age・click → graph node                                                                                                                         | 基于这个结论开一条 Work = `addNode` + `leads_to` ⚠️                                                        |

Empty: `planning` → one card "已就绪，还没有开始" with 开始执行 (+ honest NEW tag on "服务端持续推进", see D2); `achieved` → "没有需要推进的了". At scale: groups cap at 5 visible + count; 需要你 never truncates.

### 2・Exploration graph — 探索图

Business concept: `goal.graph` snapshot (nodes, edges, decisions). Layout is a layered DAG (Goal → decomposes → Work/Problem → produces → Finding → leads\_to → Decision → leads\_to → new Work); `depends_on` drawn as dashed edges. Node shape/color by kind (Problem pill purple · Work rect blue · Finding rect green · Decision hexagon orange); state by stroke (frontier thick · gate dashed warning + dot · blocked dashed · stale dotted red · resolved dimmed). Owner Task line inside the running Work node with a pulse. Hover/selection are shared with the frontier cards; clicking a node opens **节点详情** beneath the graph (state, body, attempt ledger, "在图里的位置" edges, and for a Finding "基于这个结论开一条 Work"). Zoom toggles the graph to full width.

Empty: Goal node only, with "让 Agent 先拆一版" (❌ Planner). At 100×: collapse resolved subtrees to a count badge on their parent; keep frontier and the path from Goal to each frontier node expanded.

### 3 · Contract (collapsed) · 4 · Activity (collapsed)

Requirement, goal-level checks, budget/recovery values (read; edit ⚠️/❌). Activity merges `goal_events`, attempt boundaries, Findings and decisions, one human line each. Provenance only.

### Goal list and Home

- List: facets **需要你・进行中・已暂停・已完成**, with counts; rows carry the same status sentence + last-activity age; standalone goals included (⚠️ `list` filter).
- Home rail: a pending gate is a **decision** item; today only task-carried failures produce one (⚠️ brief on Graph gate).

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

**D5 — Graph on the first screen.** Decided by the user: the frontier is the key display and the graph sits beside it. Remaining question is layout at scale (collapse resolved subtrees vs. paginate lanes) — recommend collapse-to-badge, validated in the next prototype round with a 30-node graph.
