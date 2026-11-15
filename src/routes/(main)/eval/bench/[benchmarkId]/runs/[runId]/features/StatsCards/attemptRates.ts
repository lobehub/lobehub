import type { EvalRunMetrics } from '@lobechat/types';

export interface AttemptRate {
  /** Cases counted, when the rate is a share of whole cases. */
  count?: number;
  rate: number;
}

export interface AttemptRates {
  /** Cases that passed every one of the k attempts (pass^k). */
  allK?: AttemptRate;
  /** Cases that passed at least one of the k attempts (pass@k). */
  anyK?: AttemptRate;
  k: number;
  /** Share of single attempts that passed (pass@1). */
  perAttempt?: AttemptRate;
}

const ratio = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * The rates a run of several attempts per case reports beside its pass rate.
 * The server fills them only once every case is judged, so a missing one stays
 * missing instead of reading as 0%. Returns undefined for a run of one attempt,
 * where all three equal the pass rate.
 */
export const attemptRates = (
  metrics: EvalRunMetrics | undefined,
  k: number,
): AttemptRates | undefined => {
  if (!metrics || !(k > 1)) return undefined;
  const total = metrics.totalCases ?? 0;
  const ofCases = (value: unknown): AttemptRate | undefined => {
    const rate = ratio(value);
    if (rate === undefined) return undefined;
    return { count: total > 0 ? Math.round(rate * total) : undefined, rate };
  };
  const perAttempt = ratio(metrics.passAnyAt?.['1']);
  return {
    allK: ofCases(metrics.passAllK ?? metrics.passAllAt?.[String(k)]),
    anyK: ofCases(metrics.passAtK ?? metrics.passAnyAt?.[String(k)]),
    k,
    perAttempt: perAttempt === undefined ? undefined : { rate: perAttempt },
  };
};
