# Goal detail — process control for long-horizon execution

**Date:** 2026-08-26
**Status:** discovery → aligning (frame mode; no implementation yet)
**Scope:** the Goal detail page (`/agent/:aid/goal/:goalId`) and the two places that feed into it (Goal list, Home inbox rail), redesigned as a **process-control surface** for the long-horizon Goal runtime (Goal Graph + Work recovery + Acceptance + decision gates). Out of scope: Goal creation wizard, the Acceptance workspace itself, Graph visualization as a first screen, mobile.
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

1. "I came here to find every **piece of Work** the Goal is doing."
2. "For each one I need, without another click: its **current state in plain words**, **when it last did something**, **attempt N of M**, **cost**, and the **one-line outcome** (Finding title or the verifier's reason for rejecting)."
3. "I use **attempt history, verifier reasoning, evidence files, topics, the graph, and the event ledger** only to investigate."

### First scan — answered without a click

1. Is it still moving? — status sentence **plus last-activity age** (a spinner alone is what lied in the nanoGPT run).
2. How far? — Work resolved n/m and acceptance checks passed p/q.
3. Does it need me? — one attention card at the top, or none.
4. What has it cost, and what is left? — spend / cap, attempts / cap.

### Secondary dimensions

Graph topology, chronology (events), attempt ledger, verifier transcripts, task tree, topics. All drill-down.

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
6. **Controls that exist name the wrong effect.** "Pause" reads as "stop"; the business event is "start nothing new, let the current attempt finish". "Set budget" reads as "continue"; it does not resume.

---

## 4. Principles (each with the alternative it rejects)

- **Blocked-on-you first.** The attention card sits above everything, or is absent. _Rejected:_ a chronological feed / a graph as the first screen — nothing gets stuck if the user never looks at them (`P-07`).
- **Liveness over status label.** Every running row shows last-activity age; past the lease timeout it flips to "unresponsive, reclaiming". _Rejected:_ a spinner on `running`.
- **Work is the row; attempts are the drill-down.** _Rejected:_ the Task tree and TopicCards as the body (`P-13`).
- **A gate is evidence + options + consequences + a recommendation, resolved in place.** _Rejected:_ "open the Acceptance page" / "use the CLI".
- **Controls say what they really do.** "Pause — no new attempts; the current one finishes." "Add budget and continue." _Rejected:_ generic Pause / Stop / Save.
- **Budget is a control, not a metric.** Spend is shown _against_ its cap and editable there. _Rejected:_ read-only cost in a stats row.
- **Plain-word states.** `proposed` → "Queued" / "Waiting for X"; `waiting` → "Needs your decision"; `lease_expired` → "Lost contact, restarting". _Rejected:_ exposing node/acceptance enums.

---

## 5. Information architecture — Goal detail

Block by block. Each names its business concept, its empty state, and how it holds at 100×.

### 0 · Attention card (conditional)

Exactly one card, only when the goal obliges the user to act. Variants:

| Variant               | Trigger                                            | Content                                                                                                                                                                                                                         | Actions (business event)                                                                                                          |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Decision gate         | `decisions[].status = pending`, `authority = user` | The Work it concerns · why it stopped (last verifier reason / failure error, ≤ 2 lines) · attempts used N/M · cost so far · options from `options[]` with a consequence line each · recommended option marked · optional reason | `goal.decide(optionId, reason)`. Retry → attempt N+1; Retire → Work abandoned, goal continues; Fail (terminal Work) → goal failed |
| Delivery awaiting you | goal-level acceptance `delivered`                  | Checks passed p/q · verifier summary · link to evidence                                                                                                                                                                         | `acceptance.accept` → achieved; `acceptance.reject(comment)` → another round with your comment                                    |
| Budget exhausted      | `paused` **and** (spend ≥ cap or attempts ≥ cap)   | Which cap, spent vs cap                                                                                                                                                                                                         | "Add budget and continue" = `setBudget` + `resume` composed; "Stop here" = cancel ❌ / delete                                     |
| Lost contact          | running attempt's lease older than timeout         | "No activity for 12 min; will be reclaimed automatically at 15 min"                                                                                                                                                             | "Reclaim now" = `goal.tick` (safe, deterministic); no new concept                                                                 |
| Verify errored        | `paused` with task error present, no gate          | The error                                                                                                                                                                                                                       | Retry = `task.run`; Stop                                                                                                          |

Empty: block absent (not an empty card). At scale: multiple pending gates → one card with a count and the most-blocking first; the rest listed inside the Work rows.

### 1 · Header

Title (editable) · **status sentence in plain words + last-activity age** (e.g. "Running · last activity 2 min ago", "Waiting for you · since 14:02", "Paused by you", "Paused — cost budget reached", "Done · 3/3 checks passed") · elapsed since start · controls: **Pause / Resume** (label reflects the real effect in its confirm), **Budget** (popover: rounds cap, cost cap, attempts-per-Work; save = `setBudget`), overflow (Add Work ⚠️, Copy link, Cancel ❌, Delete).

### 2 · Progress strip

Four cells: Work resolved n/m · Acceptance checks passed p/q (goal-level) · Attempts used a/b (b = maxRounds or ∞) · Spend $x / $y. Bars, not rings; caps drawn as the bar's end. Empty (planning): 0/m, 0/q, 0/b, $0.

### 3 · Work list (the body)

One row per Work node, ordered: needs-you → running → queued → done. Row contract:

- title · state chip (plain words) · last-activity age · attempts N/M · cost · one-line latest outcome
- `depends_on` rendered as "Waiting for: <Work title>" text, not edges
- expand → attempt ledger (each: started, ended, outcome, verifier verdict + reason, cost, "Open run" → topic), evidence links (work versions), Finding text, "Add guidance" (task comment, carried into the next attempt)

Empty (no Work yet): "The Goal has no Work planned yet" + Add Work. At 100×: virtualized, filter by state, done rows collapsed to a count.

### 4 · Contract

Requirement text · goal-level acceptance checks (read; edit ⚠️ for task-carried via `acceptance.saveGoal`, ❌ for Graph) · budget & recovery policy values (read here, edited in the header popover).

### 5 · Activity (collapsed)

Merged `goal_events` + attempt boundaries + human actions, one line each, human-readable. Provenance only.

### 6 · Graph (secondary tab, later)

Problem / Work / Finding / Decision nodes with stable colors; execution activity as stroke, not fill. Exploration and audit view — never the landing view.

### Goal list and Home

- List: facets **Needs you · Running · Paused · Done**, with counts; "Needs you" and budget-paused rows first; each row carries the same status sentence + last-activity age. Standalone goals included (requires `list` change ⚠️).
- Home rail: a pending gate is a **decision** item (the inbox already models decisions); today only task-carried failures produce one.

---

## 6. Scope — what does the business already support?

| Bucket | Capability                                                                                                                | Note                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ✅     | Pause / Resume / Set budget / Decide / Tick                                                                               | TRPC exists, SPA never calls it                                                             |
| ✅     | Graph snapshot: nodes, edges, decisions (options, recommendation), events, work versions                                  | `goal.graph`                                                                                |
| ✅     | Accept / Reject-with-comment on the goal-level acceptance                                                                 | verify store already used by `GoalAcceptance`                                               |
| ✅     | Task comments as guidance for the next attempt                                                                            |                                                                                             |
| ⚠️     | Standalone (Graph) goals in the list                                                                                      | drop the `subjectType = 'task'` filter, or add a second query; visibility rule needs a home |
| ⚠️     | Last-activity age / lease staleness per running Work                                                                      | operation `lastHeartbeatAt` + `operationLeaseTimeoutMs`; needs projecting into the snapshot |
| ⚠️     | Attempt ledger per Work (topics with handoff, verdicts, cost)                                                             | `taskTopicModel.findWithHandoffByTaskIds` is what tick already reads                        |
| ⚠️     | Add Work / Add edge from the UI                                                                                           | procedures exist                                                                            |
| ⚠️     | Budget-exhausted detection                                                                                                | derive from spend ≥ cap; no reason field                                                    |
| ⚠️     | Brief / inbox item for a Graph gate                                                                                       | brief model exists; `openFailureDecision` never raises one                                  |
| ❌     | **Unattended driver for Graph goals** (enqueue `tick` on task completion, verify settle, decide, resume + periodic sweep) | without it the UI must not claim "running unattended"                                       |
| ❌     | Pause reason on the goal                                                                                                  | small column + event                                                                        |
| ❌     | Cancel / edit requirement for Graph goals                                                                                 | two procedures                                                                              |
| ❌     | Stop the current attempt                                                                                                  | AbortSignal wiring through the runtime; known TODO                                          |
| ❌     | Semantic gate options                                                                                                     | generator work; UI renders `options[]` generically today                                    |
| ❌     | Progress within an attempt                                                                                                | new concept; would need a runtime progress channel                                          |
| ❌     | Partial / inconclusive terminal states                                                                                    | domain expansion                                                                            |

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

**D5 — Graph visualization.** Recommend a secondary tab after v1; never the landing view.
