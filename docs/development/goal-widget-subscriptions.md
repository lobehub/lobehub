# Durable Widget subscriptions for Goals

This runtime stacks on the schema and repair branches. It reuses `goal_subscriptions`, `widget_runs`, `metrics`, `metric_points` and the Goal's existing wait receipt. It adds no table or duplicated metric projection. Numeric observations are never copied into a Goal series.

## API and scope

`goal.bindSubscription`, `goal.listSubscriptions`, `goal.updateSubscription`, `goal.enableSubscription`, `goal.disableSubscription` and `goal.rebindSubscription` are authenticated workspace-compatible TRPC procedures. Writes require `agent:update`, Goal creator or workspace-owner management permission, live membership and read access for both the authenticated actor and Goal owner. Sources must share scope; version ownership must match its Widget; a numeric metric must belong to that Widget and match key, kind and unit.

Bind/rebind require `confirmedVersionId` and the immutable version's `confirmedContentHash`. Bind defaults disabled; explicit enablement authorizes consumption. A criterion key is unique within its Goal, serialized under the Goal lock. A result-only subscription cannot bind a numeric criterion or use threshold/change policies. Mutations use `bindingRevision`; obsolete revisions conflict. Bind, rebind and re-enable baseline after every already-reserved run, including running reservations, deliberately excluding pre-authorization evidence.

The service rechecks source access, soft deletion, version/hash, metric ownership/semantics and Goal state before consumption and numeric evaluation. Workspace membership and metric rows are held under share locks for transactional decisions. Final achievement re-evaluates numeric freshness under its existing Goal lock; bound Widget rows lock in UUID order to avoid inverse-clause deadlocks across Goals.

## Producer and consumption protocol

Both scheduled reservation (`claimDueRun`) and manual/preview reservation (`startRun`) serialize on the Widget row. They allocate `created_at` with PostgreSQL `clock_timestamp()` after that lock. A scanner holds the same lock; no pre-lock transaction timestamp can commit below its watermark. This is not a fixed-lookback repair.

`WidgetModel.finishRun` accepts a transactional metric-publication callback. `executeWidgetRun` publishes the successful current run, snapshot, metric definitions/points and metric link within that transaction. A publication exception rolls back all of them, then closes the existing run as `failed` with `METRIC_PUBLICATION_FAILED`. If storage also prevents that failure write, the run remains running: scanners stop at that barrier instead of inventing success. Scheduled lease completions also compare the worker's `startedAt` to reject superseded workers.

Subscription processing locks Goal, Widget and subscription, then reads `(created_at, UUID)` order. Positions are formatted by PostgreSQL with six fractional digits rather than round-tripped through JavaScript Dates. A bounded scan handles only a contiguous final prefix; a running row stops it. Preview, wrong-version, failed, timeout and partial rows are handled without numeric success. Successful observations require complete output, finite values, system/probe/run provenance, matching owner/workspace and fresh non-future timestamps. Observations advance only in `(observed_at, UUID)` order; older points cannot replace accepted progress.

The cursor and pending/wake coordination effect commit together. `cursor.pendingWake` contains no sampled value: it remembers eligible early observations until a wait exists or an unmanaged Goal ticks. Managed Goals use their current durable `managerState.wait.wake`; unmanaged Goals acknowledge the pending effect in their coordinator tick. Notification arrival is only a hint. A failed queue dispatch is recoverable from those durable effects.

Completion fanout, start-of-wait scans, Widget scheduler ticks and Goal sweeps invoke the same consumer. Reconciliation uses bounded cyclic UUID pages, resets to the start after a complete pass, and starts from the beginning after a process restart. The process-local page position is only an optimization; it is not the consumption watermark.

## Cadence, stops and semantics

The Widget owns collection cadence. `wakeCondition.minimumPlanningIntervalMs` independently bounds planning wakes; its default is one minute, or the observation-window interval for that policy. Matching observations remain pending inside the interval. Observation windows become eligible even with no arrivals. Existing durable wait timers are armed at the earlier collection-window boundary, and cyclic reconciliation repairs missed timers. A numeric shortfall on a subscribed unmanaged Goal stays an observation wait instead of becoming a user pause.

Pause, cancellation, failure and achievement atomically disable enabled subscriptions, increment their revision and remove pending wakes in `GoalModel.update`; existing cursor observations remain available for historical reads. Explicit re-enable establishes a new non-replay baseline. Widget schedules, history, Dashboard output and other Goals' subscriptions are unaffected. Pending human decisions gate the managed wake receipt; existing coordinator budgets and turn/pause gates remain authoritative.

Widget metric definitions retain a version content hash in their existing `metadata`. `ensure` rejects incompatible key-slot kind/unit, and publication rejects a different script/account/extraction hash on existing history. Widget metric kind/unit/metadata mutations through `update` are rejected. Empty legacy series may acquire a hash; populated untagged legacy series require a new key. This conservative policy includes the whole immutable content hash, so compatible presentational changes can also require a new metric key; it never silently reinterprets old history. Rebinding confirms a version, but cannot override series immutability.

## Dashboard and Goal read handoff

`goal.listSubscriptions({ goalId })`, exposed through `goalService.listSubscriptions`, returns `GoalSubscriptionRead` from `apps/server/src/services/goal/subscriptions.ts`:

- `subscription`: Widget/metric/version identity, binding revision, enablement, typed policies and durable cursor;
- `widget`, `metric`, `trend`: existing source rows and a bounded 200-point trend;
- `latestRun`, `latestSuccessfulRun`, `latestFailureRun`: non-preview existing run history, including failed/timeout/partial health;
- `latestSuccessfulObservation`, `fresh`, `sourceAvailable`: the accepted authoritative point and current eligibility information;
- `progress`: criterion key, value/time, eligibility, target/operator and fresh comparison;
- `goal`: Goal identity/status, acceptance contract and Manager wait/execution receipt.

`metric.listSeriesWithPoints` maps Goal criterion keys to these same Widget metric IDs and history, preserving source identity and values. `goal.graph` also returns fresh `metricCriteria`. Bind/update/enable/disable/rebind client methods live in `src/services/goal.ts`. No Dashboard renderer is included. The subsequent Dashboard Task owns presentation, bindings UI/cache invalidation and visual same-source verification.

## Validation status

The branch has syntax parsing and whitespace checks only at authoring time. Regression suites and full product collection scenarios remain unexecuted while the host resource guard is red. This document describes intended source invariants, not a passing acceptance verdict. No migration was added: the only type additions are fields in existing typed JSON policies/cursors. Schema PR #20500 stays unchanged and its schema-only acceptance does not cover this runtime.
