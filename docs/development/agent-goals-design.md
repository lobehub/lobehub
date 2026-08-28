# Agent Goals: a durable goal loop on top of Tasks

## Summary

An agent goal should not be another kind of chat session or a process that stays alive forever.
It should be a durable control loop whose execution plan is represented by the existing task tree.

The proposed relationship is:

```text
Agent
  -> Goal (intent, success contract, policy, budget, lifecycle)
    -> root Task (current plan)
      -> subtasks + dependencies (execution graph)
        -> Task Topics (individual attempts)
          -> Agent Operations (runtime/cost/trace)
```

The agent is the owner and executor. The goal is the long-lived outcome contract. Tasks are the
mutable execution plan. Topics are finite execution attempts. No worker or LLM call is kept alive
between attempts.

This reuses the strongest parts of the task system without making every task a permanent agent
goal.

## Why a first-class Goal is still needed

The current task system already provides:

- assignee agents;
- unbounded task trees and dependency edges;
- heartbeat and cron automation;
- topic-per-run history and handoff summaries;
- operation linkage, cost data, documents, comments, and briefs;
- human checkpoints and pause/resume states;
- verify-backed acceptance for task delivery.

A task can therefore be the execution substrate of a goal. It should not be the goal aggregate
itself, because a durable goal has semantics that do not belong to an individual plan node:

- an invariant objective that survives replanning;
- an explicit, machine-evaluable success contract;
- a controller lifecycle separate from task execution status;
- wake-up policies from time and external events;
- global cost, time, iteration, and concurrency budgets;
- a record of why the controller continued, waited, replanned, or stopped;
- ownership at the agent level, including which goals are currently active.

If these are stored only in `tasks.config`, the root task becomes overloaded, goal discovery by
agent is weak, status transitions become ambiguous, and future replanning cannot replace the root
plan cleanly.

## Domain model

### `agent_goals`

Recommended columns:

| Field                                  | Purpose                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`                                   | Stable goal identity                                                                |
| `agentId`                              | Agent that owns and pursues the goal                                                |
| `userId`, `workspaceId`, `visibility`  | Existing ownership and workspace rules                                              |
| `rootTaskId`                           | Current root task / plan entry point                                                |
| `title`, `objective`                   | Human-readable outcome; objective is immutable while a run is active                |
| `successCriteria`                      | Structured verify criteria and evaluator configuration                              |
| `status`                               | `draft`, `active`, `waiting`, `paused`, `achieved`, `blocked`, `canceled`, `failed` |
| `policy`                               | Replan cadence, retry/fuse, allowed triggers, concurrency                           |
| `budget`                               | Max USD, active runtime, rounds, operations, and optional deadline                  |
| `progress`                             | Cached summary, score, last decision, and counters for cheap UI reads               |
| `nextWakeAt`                           | Durable time-based wake-up hint                                                     |
| `leaseOwner`, `leaseExpiresAt`         | Single-controller execution lease                                                   |
| `startedAt`, `completedAt`, timestamps | Lifecycle audit                                                                     |

Keep `rootTaskId` nullable during draft creation. Do not put `goalId` only inside task JSONB: add a
nullable indexed `tasks.goalId` foreign key so every plan node and operation can be queried cheaply.
The root task is the node whose `id === goal.rootTaskId`.

An agent may own multiple goals, but MVP should default to one active goal per agent. Supporting
multiple active goals later is a scheduling-policy decision, not a schema rewrite.

### `agent_goal_runs`

Each controller decision is an append-only run, distinct from a task topic:

| Field                      | Purpose                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `goalId`, `seq`            | Ordered controller history and idempotency boundary                             |
| `triggerType`, `triggerId` | `created`, `timer`, `signal`, `task_completed`, `verify_settled`, `manual`      |
| `status`                   | `queued`, `running`, `waiting`, `completed`, `failed`, `canceled`               |
| `decision`                 | `execute`, `decompose`, `replan`, `verify`, `wait`, `achieve`, `pause`, `block` |
| `reason`                   | Human-readable controller rationale                                             |
| `inputSnapshot`, `output`  | Reproducible state and selected actions                                         |
| `operationId`              | Agent operation used for planning, when an LLM was needed                       |
| timestamps                 | Latency and audit                                                               |

Use a uniqueness constraint over the durable trigger identity, for example
`(goalId, triggerType, triggerId)`, so at-least-once queue delivery cannot create two rounds.

### Optional `agent_goal_events`

Do not add this in the first migration unless product needs a user-facing activity stream that
cannot be reconstructed. Agent Signal traces plus `agent_goal_runs` cover the initial audit need.

## Runtime architecture

### Finite controller turns, not a permanent process

“7x24 running” means that the goal can always resume from durable state. It must not mean an open
HTTP response, an endless LLM loop, or an in-memory timer.

Every controller turn is finite:

```text
wake event
  -> acquire goal lease
  -> load goal + task graph + latest handoffs + verify state + budgets
  -> choose exactly one bounded decision
  -> persist decision and enqueue/execute bounded actions
  -> set nextWakeAt or wait for an event
  -> release lease
```

Production execution should use a durable queue/workflow. Local mode may use in-process scheduling
for developer ergonomics, but must be documented as non-durable across restarts.

### Goal controller decisions

The controller is not another general chat agent. Give it a narrow output schema:

```ts
type GoalDecision =
  | { type: 'execute'; taskIds: string[] }
  | { type: 'decompose'; parentTaskId: string; tasks: ProposedTask[] }
  | { type: 'replan'; mutations: TaskGraphMutation[]; reason: string }
  | { type: 'verify'; subjectTaskId: string }
  | { type: 'wait'; reason: string; wakeAt?: string }
  | { type: 'achieve'; evidence: EvidenceRef[] }
  | { type: 'pause'; reason: string }
  | { type: 'block'; reason: string; requestedInput?: string };
```

One turn may start a bounded set of ready tasks in parallel, subject to the goal concurrency policy.
It must not recursively call itself. Completion events enqueue the next controller turn.

### Wake-up sources

Use Agent Signal as the event interpretation and routing layer:

```text
task topic completed / verify settled / document changed / connector event / timer
  -> source event
  -> signal.goal.wake-requested
  -> action.goal.enqueue-turn
  -> durable goal workflow
```

Agent Signal should decide whether an event matters and dedupe it. The goal controller should own
goal state transitions and task-plan mutation. This avoids coupling every connector or task hook to
goal orchestration.

Time wake-ups can reuse the task scheduler conceptually, but should expose a generic durable
`scheduleGoalWake` API rather than pretending every wake is a heartbeat task topic. A delayed
message is one-shot; after handling it, the controller chooses whether another wake is needed.

### Task execution and feedback

The existing `TaskRunnerService` remains the only path that starts task work. A goal controller
selects ready tasks; it does not execute tools itself.

When a topic completes:

1. Task lifecycle persists status, handoff, brief, and verify linkage as today.
2. A source event records the durable fact.
3. Goal policy maps it to a wake request if the task has `goalId`.
4. The controller reloads authoritative DB state and decides what is next.

This keeps lifecycle hooks observational and makes retries safe.

## Success, replanning, and stopping

### Success is verified, not self-declared

The controller may propose `achieve`, but the goal only reaches `achieved` after its structured
success criteria pass. Reuse Verify as the acceptance plane. Evidence must reference durable
artifacts, task outputs, connector objects, or checks rather than only an LLM narrative.

Use two nested loops:

```text
inner loop: one task attempt -> verify/repair that delivery
outer loop: goal progress review -> execute more tasks or replan the task graph
```

The existing `feat/goal-loop-server` exploration already demonstrates the useful inner primitive:
a failed verify result can spawn a fresh topic, carry handoffs and failed checks forward, and stop on
round/cost budgets. The agent-level goal controller should generalize the outer loop rather than
duplicating that logic inside every task.

### Waiting, blocked, and paused are different

- `waiting`: healthy; awaiting a known event or future time. May auto-resume.
- `blocked`: the agent cannot make meaningful progress without new authority/input. Never
  auto-resume unless the blocking condition changes.
- `paused`: explicitly stopped by a user, policy, fuse, or budget. Requires an explicit resume or
  policy change.
- `failed`: unrecoverable controller/system failure after the retry policy is exhausted.

A goal should not become blocked after one weak attempt. Persist a repeated-condition fingerprint;
only block once the same condition survives the configured number of controller turns.

### Budgets and safety

Every active goal needs hard server-enforced limits:

- total cost and per-day cost;
- max controller turns and max task attempts;
- max concurrent task topics;
- optional deadline and active-hours window;
- consecutive runtime failure fuse;
- allowed tool/plugin policy and human-approval policy.

Budget checks happen both before enqueue and immediately before execution. The database is the
authority because queued work may be stale.

Never promise literal uninterrupted execution. Billing failure, revoked credentials, connector
outages, approval requirements, and infrastructure incidents must transition to a visible state and
brief rather than spin indefinitely.

## Lease and idempotency rules

At-least-once delivery is assumed.

1. Acquire a short DB/Redis lease keyed by `goalId` before creating a run.
2. Insert the run using its unique trigger key.
3. Re-read goal status and budgets after acquiring the lease.
4. Use stable action idempotency keys such as `goal:{goalId}:run:{seq}:task:{taskId}:execute`.
5. Task execution still relies on its existing in-flight topic conflict guard.
6. Persist `nextWakeAt` before publishing the delayed wake; save the returned queue message id when
   cancellation is supported.
7. A stale wake is harmless: the handler exits when status, generation, or `nextWakeAt` no longer
   matches.

Add a `generation` integer to the goal if edits/resume should invalidate all queued work cheaply.

## MVP rollout

### Phase 0: align the existing task goal loop

Before adding the aggregate, finish or reuse the existing `feat/goal-loop-server` work:

- `TaskGoalConfig` under `tasks.config.goal`;
- verify-failure continuation into a fresh task topic;
- round and USD budgets;
- failed-check and handoff carry-over;
- goal tool-card state projection.

Treat this as a task-level execution primitive, not the final agent-goal model.

### Phase 1: first-class aggregate and manual controller

- Add `agent_goals`, `agent_goal_runs`, and indexed `tasks.goalId`.
- Add Goal model/service and CRUD/status transitions.
- Create a goal and its root task atomically.
- Implement a manually invoked controller turn with pure decision validation.
- Support one active goal per agent and a small concurrency cap.
- Reuse TaskRunner and Verify; do not add event-driven wakes yet.

This phase proves the semantics and UI without claiming 7x24 durability.

### Phase 2: durable time and lifecycle wakes

- Add durable goal workflow and lease/idempotency.
- Emit task-completion and verify-settled source events.
- Add Agent Signal goal wake policy and one-shot timer wakes.
- Add restart recovery scan for active goals whose `nextWakeAt` is overdue and have no valid lease.
- Add observability: queue delay, controller latency, decision counts, budget use, stuck goals.

At this point the system can honestly claim unattended continuous pursuit in queue mode.

### Phase 3: external signals and replanning

- Allow connector/domain events to wake selected goals.
- Add constrained task-graph mutation operations.
- Add evidence-aware progress evaluation and replanning prompts.
- Support multiple goals per agent with explicit priority/fairness policy.

## Suggested code boundaries

```text
packages/database/src/schemas/agentGoal.ts
packages/database/src/models/agentGoal.ts
packages/database/src/models/agentGoalRun.ts
packages/types/src/agentGoal/

apps/server/src/services/agentGoal/
  AgentGoalService.ts       # CRUD and lifecycle invariants
  GoalController.ts         # bounded decide/apply turn
  GoalContextBuilder.ts     # goal + task graph + evidence snapshot
  GoalBudgetService.ts
  GoalLeaseService.ts
  decisions.ts              # schema and validation

apps/server/src/workflows/agentGoal/
apps/server/src/services/agentSignal/policies/goalWake/
apps/server/src/routers/lambda/agentGoal.ts
```

Avoid placing the controller inside `TaskLifecycleService`; lifecycle completion must remain
bounded and resilient. It should emit/enqueue and return.

## MVP acceptance criteria

The first durable release is complete when all of these are true:

1. Creating a goal atomically creates an agent-owned goal and root task.
2. A controller turn can decompose the root into task dependencies and start only ready tasks.
3. Duplicate wake delivery cannot create duplicate runs or task topics.
4. A server restart does not lose an active goal's future wake in queue mode.
5. Task/verify completion wakes the goal without a foreground client connection.
6. Verified success is the only automatic path to `achieved`.
7. Cost, attempt, concurrency, pause, and cancellation limits are enforced server-side.
8. Waiting, blocked, budget-paused, runtime-failed, and achieved states are distinguishable in DB
   and UI.
9. Every controller decision is inspectable with its trigger, reason, task mutations, operation, and
   cost.
10. Local mode clearly reports that timers are development-only and non-durable.

## Product shape

The primary agent surface should show a single “Current goal” card with:

- objective and verified progress;
- current plan (the existing task tree);
- current state and the next expected wake-up;
- spend/round/deadline budget;
- latest controller reason;
- pause, resume, edit budget, and cancel controls.

The user should not need to understand controller turns. They should see what the agent is pursuing,
what it is doing now, what it is waiting for, and what proof will count as done.
