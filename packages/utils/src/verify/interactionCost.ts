import {
  GOMS_KLM_MODEL,
  GOMS_KLM_TIMING_SECONDS,
  GOMS_KLM_TRACE_SCHEMA,
} from '@lobechat/const/verify';
import type {
  VerifyInteractionCost,
  VerifyInteractionCostOperators,
  VerifyInteractionCostPhase,
} from '@lobechat/types';

/**
 * The standard GOMS-KLM counting logic for acceptance rounds.
 *
 * A UI driver records one atom per action into a JSONL trace, carrying only raw
 * operator counts. This module is the single place those counts become seconds,
 * so a published `interactionCost` is always reproducible from its trace instead
 * of being whatever number a driver happened to compute.
 *
 * Interaction cost is an optional overlay: no driver, no trace, no cost. Callers
 * treat an absent or unreadable trace as "this round has no interaction cost",
 * never as a failure.
 */

/** One recorded interaction atom. Unknown fields are ignored, not rejected. */
export interface KlmTraceEvent {
  durationMs?: number;
  klm?: {
    category?: string;
    operators?: VerifyInteractionCostOperators;
  };
  mentalEstimate?: Record<string, unknown>;
  phase?: {
    checkItemId?: string;
    id?: string;
    label?: string;
  };
  schema?: string;
  type?: string;
}

const UNSCOPED_PHASE = 'unscoped';

const emptyOperators = (): Required<VerifyInteractionCostOperators> => ({
  H: 0,
  K: 0,
  M: 0,
  P: 0,
  R_ms: 0,
  T_chars: 0,
});

const round = (value: number): number => Math.round(value * 100) / 100;

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const addOperators = (
  target: Required<VerifyInteractionCostOperators>,
  source: VerifyInteractionCostOperators = {},
): void => {
  target.H += num(source.H);
  target.K += num(source.K);
  target.M += num(source.M);
  target.P += num(source.P);
  target.R_ms += num(source.R_ms);
  target.T_chars += num(source.T_chars);
};

/** Price only the operators a person performs; measured wait is charged separately. */
const activeSeconds = (operators: Required<VerifyInteractionCostOperators>): number =>
  round(
    operators.H * GOMS_KLM_TIMING_SECONDS.H +
      operators.K * GOMS_KLM_TIMING_SECONDS.K +
      operators.M * GOMS_KLM_TIMING_SECONDS.M +
      operators.P * GOMS_KLM_TIMING_SECONDS.P +
      operators.T_chars * GOMS_KLM_TIMING_SECONDS.T_char,
  );

const totalSeconds = (operators: Required<VerifyInteractionCostOperators>): number =>
  round(activeSeconds(operators) + operators.R_ms / 1000);

/**
 * Parse a trace file's contents. A malformed line is dropped rather than
 * failing the whole trace — a truncated last line (the run was killed mid-write)
 * must not cost the round every atom before it.
 */
export const parseKlmTrace = (raw: string): KlmTraceEvent[] =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === 'object' ? [parsed as KlmTraceEvent] : [];
      } catch {
        return [];
      }
    });

interface SummarizeOptions {
  /** Model id label; defaults to the pinned standard model. */
  model?: string;
  /** Trace filename recorded on the summary so a reader can re-derive it. */
  sourceTrace?: string;
}

/**
 * Sum a trace into the `interactionCost` shape the acceptance page renders.
 *
 * Returns `null` when nothing priceable was recorded — an empty trace, or one
 * where every attempt was blocked (the classic case: agent-browser is not
 * installed, so each action failed and was charged zero). Publishing that as a
 * 0s cost would render a failed run as a free one; no measurement is the honest
 * outcome.
 */
export const summarizeKlmTrace = (
  events: KlmTraceEvent[],
  { model = GOMS_KLM_MODEL, sourceTrace }: SummarizeOptions = {},
): VerifyInteractionCost | null => {
  const usable = events.filter(
    (event) => event.schema === undefined || event.schema === GOMS_KLM_TRACE_SCHEMA,
  );
  if (usable.length === 0) return null;

  const operators = emptyOperators();
  const categoryCounts: Record<string, number> = {};
  const mentalEstimates: Record<string, unknown>[] = [];
  const phases = new Map<
    string,
    {
      actionCount: number;
      actualAgentMs: number;
      checkItemId?: string;
      id: string;
      label?: string;
      operators: Required<VerifyInteractionCostOperators>;
    }
  >();
  let actualAgentMs = 0;

  for (const event of usable) {
    const eventOperators = event.klm?.operators ?? {};
    addOperators(operators, eventOperators);

    const category = event.klm?.category ?? 'unknown';
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    actualAgentMs += num(event.durationMs);

    if (event.type === 'mental_estimate' && event.mentalEstimate) {
      mentalEstimates.push({ ...event.mentalEstimate, phaseId: event.phase?.id });
    }

    const key = event.phase?.id || event.phase?.checkItemId || UNSCOPED_PHASE;
    const phase = phases.get(key) ?? {
      actionCount: 0,
      actualAgentMs: 0,
      checkItemId: event.phase?.checkItemId,
      id: key,
      label: event.phase?.label || (key === UNSCOPED_PHASE ? undefined : key),
      operators: emptyOperators(),
    };

    addOperators(phase.operators, eventOperators);
    phase.actionCount += 1;
    phase.actualAgentMs += num(event.durationMs);
    phases.set(key, phase);
  }

  const phaseItems: VerifyInteractionCostPhase[] = [...phases.values()]
    .map((phase) => ({
      actionCount: phase.actionCount,
      activeSeconds: activeSeconds(phase.operators),
      actualAgentSeconds: round(phase.actualAgentMs / 1000),
      checkItemId: phase.checkItemId,
      id: phase.id,
      label: phase.label,
      operators: phase.operators,
      seconds: totalSeconds(phase.operators),
      waitSeconds: round(phase.operators.R_ms / 1000),
    }))
    .sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0));

  const total = totalSeconds(operators);
  // Every action blocked (no driver installed, or the whole UI run died) sums to
  // zero. That is an absence of measurement, not a measurement of zero.
  if (total === 0) return null;

  return {
    actionCount: usable.length,
    activeSeconds: activeSeconds(operators),
    actualAgentSeconds: round(actualAgentMs / 1000),
    categoryCounts,
    generatedAt: new Date().toISOString(),
    mentalEstimates,
    model,
    operators,
    phases: phaseItems,
    scope: 'user-equivalent',
    sourceTrace,
    timingSeconds: GOMS_KLM_TIMING_SECONDS,
    totalSeconds: total,
    waitSeconds: round(operators.R_ms / 1000),
  };
};
