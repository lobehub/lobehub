import type {
  VerifyInteractionCost,
  VerifyInteractionCostOperators,
  VerifyInteractionCostPhase,
} from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';

/**
 * Reading and pricing helpers for a round's user-equivalent interaction cost.
 *
 * Split from the panel so the values can be unit-tested and reused without
 * mounting React — the acceptance page selects which round to show from these,
 * and the panel is left as presentation.
 */

export const OPERATOR_KEYS = ['K', 'P', 'M', 'H', 'T_chars', 'R_ms'] as const;
export type OperatorKey = (typeof OPERATOR_KEYS)[number];

/** Fallback pricing for a cost recorded before `timingSeconds` travelled with it. */
const OPERATOR_DEFAULT_SECONDS: Record<OperatorKey, number> = {
  H: 0.4,
  K: 0.2,
  M: 1.35,
  P: 1.1,
  R_ms: 0.001,
  T_chars: 0.2,
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const finiteString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const readOperators = (value: unknown): VerifyInteractionCostOperators => {
  const record = toRecord(value);
  if (!record) return {};

  return {
    H: finiteNumber(record.H),
    K: finiteNumber(record.K),
    M: finiteNumber(record.M),
    P: finiteNumber(record.P),
    R_ms: finiteNumber(record.R_ms),
    T_chars: finiteNumber(record.T_chars),
  };
};

const readTimingSeconds = (value: unknown): Record<string, number> | undefined => {
  const record = toRecord(value);
  if (!record) return undefined;

  const entries = Object.entries(record).flatMap(([key, field]) => {
    const seconds = finiteNumber(field);
    return seconds === undefined ? [] : [[key, seconds] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const readPhase = (value: unknown, index: number): VerifyInteractionCostPhase | null => {
  const record = toRecord(value);
  if (!record) return null;

  const seconds = finiteNumber(record.seconds);
  const activeSeconds = finiteNumber(record.activeSeconds);
  const waitSeconds = finiteNumber(record.waitSeconds);
  const hasTiming =
    seconds !== undefined || activeSeconds !== undefined || waitSeconds !== undefined;
  if (!hasTiming) return null;

  return {
    actionCount: finiteNumber(record.actionCount),
    activeSeconds,
    checkItemId: finiteString(record.checkItemId),
    id: finiteString(record.id) ?? `phase-${index + 1}`,
    label: finiteString(record.label),
    operators: readOperators(record.operators),
    seconds,
    waitSeconds,
  };
};

/** Lift the interaction cost off a run's metadata bag; `null` when unpriced. */
export const readInteractionCost = (metadata: unknown): VerifyInteractionCost | null => {
  const cost = toRecord(toRecord(metadata)?.interactionCost);
  if (!cost) return null;

  const totalSeconds = finiteNumber(cost.totalSeconds);
  if (totalSeconds === undefined) return null;

  return {
    actionCount: finiteNumber(cost.actionCount),
    activeSeconds: finiteNumber(cost.activeSeconds) ?? 0,
    model: finiteString(cost.model) ?? 'goms-klm',
    operators: readOperators(cost.operators),
    phases: Array.isArray(cost.phases)
      ? cost.phases
          .map((phase, index) => readPhase(phase, index))
          .filter((phase): phase is VerifyInteractionCostPhase => Boolean(phase))
      : [],
    scope: finiteString(cost.scope),
    sourceTrace: finiteString(cost.sourceTrace),
    timingSeconds: readTimingSeconds(cost.timingSeconds),
    totalSeconds,
    waitSeconds: finiteNumber(cost.waitSeconds) ?? 0,
  };
};

export const formatSeconds = (seconds: number): string =>
  `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}s`;

export const phaseSeconds = (phase: VerifyInteractionCostPhase): number =>
  phase.seconds ?? (phase.activeSeconds ?? 0) + (phase.waitSeconds ?? 0);

const operatorSeconds = (
  key: OperatorKey,
  value: number,
  timingSeconds?: Record<string, number>,
): number => {
  if (key === 'R_ms') return value / 1000;
  if (key === 'T_chars') {
    return (
      value * (timingSeconds?.T_chars ?? timingSeconds?.T_char ?? OPERATOR_DEFAULT_SECONDS[key])
    );
  }

  return value * (timingSeconds?.[key] ?? OPERATOR_DEFAULT_SECONDS[key]);
};

export const operatorValue = (key: OperatorKey, value: number): string => {
  if (key === 'R_ms') return formatSeconds(value / 1000);
  if (key === 'T_chars') return `${Math.round(value)} chars`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

export const phaseOperatorSegments = (
  phase: VerifyInteractionCostPhase,
  timingSeconds?: Record<string, number>,
): { key: OperatorKey; seconds: number; value: number }[] =>
  OPERATOR_KEYS.flatMap((key) => {
    const value = phase.operators?.[key];
    if (value === undefined || value <= 0) return [];

    const seconds = operatorSeconds(key, value, timingSeconds);
    return seconds > 0 ? [{ key, seconds, value }] : [];
  });
