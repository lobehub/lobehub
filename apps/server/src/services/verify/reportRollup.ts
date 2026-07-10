import type { VerifyVerdict } from '@lobechat/types';

import type { VerifyCheckResultItem } from '@/database/schemas/verify';

export interface ReportStats {
  failed: number;
  passed: number;
  total: number;
  uncertain: number;
}

/**
 * Verdict-space rollup over a run's results, mirroring `VerifyStatusService`'s
 * gate so the report card can never disagree with the operation's verify_status.
 * Pure (no I/O) so it's unit-testable without the model-runtime chain.
 */
export const rollupVerdict = (results: VerifyCheckResultItem[]): VerifyVerdict => {
  const required = results.filter((r) => r.required);
  const failed = (r: VerifyCheckResultItem) => r.status === 'failed' || r.verdict === 'failed';
  const unresolved = (r: VerifyCheckResultItem) =>
    r.verdict === 'uncertain' || (!r.verdict && r.status !== 'skipped');

  if (required.some(failed)) return 'failed';
  if (required.some(unresolved)) return 'uncertain';
  return 'passed';
};

/** Verdict tallies for the report's statistics snapshot (pending/skipped → total only). */
export const countStats = (results: VerifyCheckResultItem[]): ReportStats => ({
  failed: results.filter((r) => r.verdict === 'failed').length,
  passed: results.filter((r) => r.verdict === 'passed').length,
  total: results.length,
  uncertain: results.filter((r) => r.verdict === 'uncertain').length,
});

/** Mean of the present confidences, rounded to the column's 0.00–1.00 scale. */
export const meanConfidence = (results: VerifyCheckResultItem[]): number | null => {
  const values = results.map((r) => r.confidence).filter((c): c is number => typeof c === 'number');
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 100) / 100;
};
