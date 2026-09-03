// ============================================
// Metric — generic numeric time series (`metrics` / `metric_points` tables)
// ============================================

/**
 * What a metric can be mounted on. Deliberately open-ended: the table stores a
 * polymorphic `subjectType` / `subjectId` pair with no FK (mirroring `goals`),
 * so new subject kinds are a type-only change. Goals are the first consumer;
 * the metrics layer itself never special-cases any of these.
 */
export type MetricSubjectType = 'goal' | 'task' | 'agent' | 'project' | 'workspace';

/**
 * Aggregation semantics of a series — the one thing a chart renderer cannot
 * infer from the data:
 *
 * - `gauge` — an instantaneous level (follower count, error rate). Downsample
 *   with last/avg; plot the raw line.
 * - `counter` — a monotonically growing total (posts published, dollars
 *   spent). Downsample with max; plot deltas when showing activity.
 */
export type MetricKind = 'gauge' | 'counter';

/** How a data point entered the system. */
export type MetricPointSourceType = 'probe' | 'manual' | 'api';

/** Who recorded a data point — mirrors the goal_events actor convention. */
export type MetricActorType = 'user' | 'agent' | 'system';

/**
 * Display and evaluation hints for one series. Lives in JSONB: none of these
 * fields are queried server-side, and the set will grow with the chart layer.
 */
export interface MetricConfig {
  /**
   * Which way is progress. Lets the UI color a trend and lets goal criteria
   * evaluation read "current vs target" without per-metric special cases.
   */
  direction?: 'higher_is_better' | 'lower_is_better';
  /** Display decimal places; undefined leaves formatting to the unit default. */
  precision?: number;
  /**
   * Expected sampling cadence as a hint for gap detection and bucket choice
   * (e.g. 'P1D' for daily probes). Purely advisory — writes are never gated.
   */
  sampleIntervalHint?: string;
  /** Target value for progress rendering and numeric acceptance criteria. */
  target?: number;
}
