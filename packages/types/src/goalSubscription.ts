import type { GoalMetricComparison } from './goal';
import type { MetricKind } from './metric';

/** Planning policy; collection cadence remains owned by the Widget schedule. */
export type GoalSubscriptionWakeCondition =
  | { type: 'each_valid_run' }
  | { intervalMs: number; type: 'observation_window' }
  | { op: GoalMetricComparison; target: number; type: 'threshold' }
  | { minimumAbsoluteChange: number; type: 'change' };

/** Strict eligibility for Goal evaluation, independent of card rendering. */
export interface GoalSubscriptionFreshnessPolicy {
  /** Positive age limit measured against metric_points.observed_at or run.finished_at. */
  maxAgeMs: number;
  /** Nonnegative tolerance for future-dated source observations. */
  maxFutureSkewMs: number;
}

/** Explicitly confirmed meaning; any version change requires confirmation again. */
export interface GoalSubscriptionSemanticBinding {
  /** Stable Goal acceptance clause key; does not create a Goal-owned metric copy. */
  criterionKey?: string;
  /** Metric binding is absent for a result-only subscription. */
  metric?: { key: string; kind: MetricKind; unit: string | null };
  /** SHA-256 of canonical source/account, extraction, key, kind and unit semantics. */
  semanticsHash: string;
}

/** Durable position, not another observation store. All instants are UTC ISO strings. */
export interface GoalSubscriptionCursor {
  /** Last durable planning request; used to enforce planning cadence across restarts. */
  lastWakeAt?: string;
  /** Last accepted observation in (observed_at, UUID) order for this binding. */
  observation?: { observedAt: string; pointId: string };
  /** Last completely handled run in (created_at, UUID) order; never a running run. */
  run?: { createdAt: string; runId: string };
}
