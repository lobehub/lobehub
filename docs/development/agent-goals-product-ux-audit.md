# Agent Goals product and UX audit

## Scope

Audited the complete implemented journey:

```text
Topic Goal lab gate
  → Agent navigation
  → Goal list
  → Goal detail
  → Acceptance checks and latest result
  → Task execution plan
  → Agent runs / operations
```

Evidence sources: task and acceptance domain types, Task lifecycle/store behavior,
Goal list/detail routes, Agent navigation, Acceptance bundle hooks, and browser
verification against representative local data.

## Product model

| Concept        | Business role                                                        | Terminal fact                                                                          |
| -------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Goal           | Stable result the Agent keeps pursuing                               | The user-visible objective remains stable while its plan and runs change               |
| Acceptance     | Decision contract and evidence for whether the result is good enough | Human acceptance closes the delivery lifecycle; verifier output is supporting evidence |
| Task           | Current executable plan for pursuing the Goal                        | Task status describes execution, not Goal success                                      |
| Task execution | One scheduled/manual/heartbeat attempt represented by a task topic   | Produces an execution outcome and may trigger verification or another round            |
| Agent run      | Gateway operation actually executed by an Agent                      | Supplies execution provenance; it does not by itself mean the Goal succeeded           |

The UI therefore treats Goal as the lookup object, Acceptance as attached proof,
and Task/Agent Run as drill-down execution evidence.

## User view model

When a user opens Goals, the first scan must answer:

1. What outcomes is this Agent pursuing?
2. Which goals need attention and how close are they to acceptance?
3. On a Goal, what exactly is the target?
4. How much execution has happened (Task executions and Agent runs)?
5. What is the latest acceptance result, and what evidence supports it?

Chronology, task configuration, individual topics and operations are secondary
audit dimensions. They remain accessible through the execution-plan drill-down.

## Implemented corrections

- Goal list defaults to a dense list for scanning and supports explicit List/Card switching.
- Goal detail begins with the complete Goal definition.
- The first screen then shows Acceptance progress, Task execution count, Agent run
  count, round budget, and the latest acceptance result.
- Acceptance checks are displayed as the proof attached to the Goal, not as an
  unrelated report.
- Current execution plan is secondary and links to the existing Task Detail.
- Loading, transient error, not-found and lab-gated deep-link states are distinct.

## End-to-end audit

| Stage       | Expected behavior                                                         | Result  |
| ----------- | ------------------------------------------------------------------------- | ------- |
| Gate        | Disabled lab hides navigation and redirects Goal deep links               | Covered |
| Entry       | Goal is an Agent-level destination                                        | Covered |
| Browse      | Default list supports fast comparison; Card view remains available        | Covered |
| Inspect     | Goal definition and progress lead; execution internals are secondary      | Covered |
| Judge       | Acceptance checks and latest result are visible                           | Covered |
| Investigate | User can open the underlying Task execution plan                          | Covered |
| Recover     | Fetch errors offer retry; missing Goal is not reported as a network error | Covered |

## Honest remaining boundaries

### Direct Goal creation — not modeled as a management-page event

Goals are currently created through the `/goal` conversation flow, which creates
the goal-marked root Task and Acceptance contract. The Goal page has no standalone
create event or form contract. Adding a decorative Create button would promise a
business event that does not yet exist. A future slice should first define whether
creation starts a conversation draft, creates a durable Goal immediately, or opens
a structured contract editor.

### At-scale browsing — data capability required

The current Goal query is capped at 100 records and has no cursor/search contract.
The view is suitable for the current Agent-level collection, but a 10k Goal manager
requires server-side pagination, search, sort and status facets so counts and empty
results remain truthful across the full set.

### Dedicated Goal lifecycle actions — intentionally delegated

Pause/resume/run controls currently belong to the underlying Task execution model.
Before adding Goal-level controls, the controller must define their business event:
whether they pause scheduling only, suspend all external wakes, or terminate the
Goal contract. Until then, Goal Detail links to Task Detail rather than presenting
ambiguous controls.

## Coverage signal

- High confidence: navigation, gate, list/detail information architecture,
  Acceptance projection, Task drill-down, local loading/error behavior.
- Medium confidence: Agent run count is derived from persisted/running operation
  provenance in task activities; the future dedicated Goal model should expose an
  explicit aggregate rather than relying on projection.
- Not covered by the current model: controller wake history, cost budget, deadline,
  lease ownership and Goal-level pause/terminate semantics described in the broader
  architecture proposal.
