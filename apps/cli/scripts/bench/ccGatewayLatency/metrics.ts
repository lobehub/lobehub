/**
 * Pure metric math for the gateway-mode Claude Code latency bench.
 *
 * A turn is recorded as a list of client-side marks (ms since the turn's
 * `send`) plus every gateway event with its local receive time. Everything
 * here is deterministic so the derivation is unit-tested without a live run.
 */

/** One gateway frame as the bench client received it. */
export interface ReceivedEvent {
  /** Local receive time, ms since the turn's send. */
  at: number;
  /** `chunkType` for `stream_chunk`, `phase` for `step_complete`. */
  detail?: string;
  /** Server-side emit time (epoch ms), when the frame carries one. */
  serverTimestamp?: number;
  type: string;
}

export type ScenarioName = 'approve' | 'followUp' | 'hello' | 'image' | 'reject';

export interface TurnRecord {
  events: ReceivedEvent[];
  /** Client marks in ms since send: `ack`, `approvalCard`, `resolveSent`, `resolveAck`. */
  marks: Partial<Record<ClientMark, number>>;
  operationId?: string;
  scenario: ScenarioName;
  /** Wall-clock send time (epoch ms), to line the turn up with device or server logs. */
  sentAtEpoch?: number;
  topicId?: string;
}

export type ClientMark = 'ack' | 'approvalCard' | 'resolveAck' | 'resolveSent';

/**
 * Metrics per turn, all ms since the user pressed send unless named `…AfterResolve`.
 *
 * - `ack`: `execAgent` answered (the composer leaves its sending state).
 * - `init`: `agent_runtime_init` arrived; the server finished dispatching.
 * - `deviceFirstEvent`: the first frame produced on the device (the CLI wrapper
 *   started Claude Code and the event made it back through ingest).
 * - `firstOutput`: the first visible output — text, reasoning, or a tool call.
 * - `visibleEnd`: `visible_output_end`; the Web composer stops showing the
 *   run as busy and accepts the next message.
 * - `end`: `agent_runtime_end`; the server has settled the run (works,
 *   lifecycle hooks, queued follow-ups start here).
 * - `approvalEvent` / `approvalCard`: the approval request frame, and the
 *   moment the client has the tool row it renders the card from.
 * - `nextOutputAfterResolve`: from the approve/reject click to the next output.
 */
export interface TurnMetrics {
  ack?: number;
  approvalCard?: number;
  approvalEvent?: number;
  deviceFirstEvent?: number;
  end?: number;
  firstOutput?: number;
  init?: number;
  nextOutputAfterResolve?: number;
  visibleEnd?: number;
}

export type MetricName = keyof TurnMetrics;

/** Frames the server emits on its own before the device produces anything. */
const SERVER_ONLY_TYPES = new Set(['agent_runtime_init', 'step_start', 'notify_update']);

/** Frames that put something new in front of the reader. */
export const isOutputEvent = (event: ReceivedEvent): boolean => {
  if (event.type === 'tool_start' || event.type === 'tool_end') return true;
  if (event.type === 'stream_chunk')
    return (
      event.detail === 'text' || event.detail === 'reasoning' || event.detail === 'tools_calling'
    );
  // Protocol v2 delivers message content as revisions instead of chunks.
  return event.type === 'message_patch';
};

const firstAt = (events: ReceivedEvent[], match: (event: ReceivedEvent) => boolean) =>
  events.find(match)?.at;

export const deriveTurnMetrics = (turn: TurnRecord): TurnMetrics => {
  const { events, marks } = turn;
  const metrics: TurnMetrics = {
    ack: marks.ack,
    approvalCard: marks.approvalCard,
    approvalEvent: firstAt(events, (e) => e.type === 'agent_intervention_request'),
    deviceFirstEvent: firstAt(events, (e) => !SERVER_ONLY_TYPES.has(e.type)),
    end: firstAt(events, (e) => e.type === 'agent_runtime_end'),
    firstOutput: firstAt(events, isOutputEvent),
    init: firstAt(events, (e) => e.type === 'agent_runtime_init'),
    visibleEnd: firstAt(events, (e) => e.type === 'visible_output_end'),
  };

  if (marks.resolveSent !== undefined) {
    const resolvedAt = marks.resolveSent;
    const next = firstAt(
      events,
      (e) =>
        e.at >= resolvedAt &&
        isOutputEvent(e) &&
        // The approval's own echo is bookkeeping, not the agent continuing.
        e.type !== 'message_patch',
    );
    if (next !== undefined) metrics.nextOutputAfterResolve = next - resolvedAt;
  }

  return metrics;
};

/** Nearest-rank percentile; `undefined` for an empty sample. */
export const percentile = (values: number[], p: number): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
};

export interface MetricSummary {
  max: number;
  min: number;
  n: number;
  p50: number;
  p90: number;
}

export const summarize = (values: number[]): MetricSummary | undefined => {
  if (values.length === 0) return undefined;
  return {
    max: Math.max(...values),
    min: Math.min(...values),
    n: values.length,
    p50: percentile(values, 50)!,
    p90: percentile(values, 90)!,
  };
};

export type ScenarioSummary = Partial<Record<MetricName, MetricSummary>>;

export const summarizeScenario = (turns: TurnMetrics[]): ScenarioSummary => {
  const names = new Set(turns.flatMap((turn) => Object.keys(turn) as MetricName[]));
  const summary: ScenarioSummary = {};
  for (const name of names) {
    const values = turns
      .map((turn) => turn[name])
      .filter((value): value is number => typeof value === 'number');
    const stats = summarize(values);
    if (stats) summary[name] = stats;
  }
  return summary;
};

/** Ceilings on the p50 of a metric; unlisted metrics are reported, not gated. */
export type ScenarioBudget = Partial<Record<MetricName, number>>;

export interface BudgetViolation {
  /** The p50, or `undefined` when no turn produced the metric. */
  actual: number | undefined;
  budget: number;
  metric: MetricName;
  /** Turns that produced the metric; fewer than the turns run is a violation too. */
  samples: number;
  scenario: ScenarioName;
}

/**
 * Gate every scenario that ran. A budgeted metric that some turn never
 * produced (no output, the card never showed) fails the gate as well, so a
 * run cannot pass on the turns that happened to work.
 */
export const checkBudgets = (
  summaries: Partial<Record<ScenarioName, ScenarioSummary>>,
  budgets: Partial<Record<ScenarioName, ScenarioBudget>>,
  turnsPerScenario: number,
): BudgetViolation[] => {
  const violations: BudgetViolation[] = [];
  for (const [scenario, budget] of Object.entries(budgets) as [ScenarioName, ScenarioBudget][]) {
    const summary = summaries[scenario];
    if (!summary) continue;
    for (const [metric, ceiling] of Object.entries(budget) as [MetricName, number][]) {
      const stats = summary[metric];
      const samples = stats?.n ?? 0;
      if (!stats || samples < turnsPerScenario || stats.p50 > ceiling)
        violations.push({ actual: stats?.p50, budget: ceiling, metric, samples, scenario });
    }
  }
  return violations;
};
