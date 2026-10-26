import { isCheckWaivedByDispute } from '@lobechat/const/verify';
import type { VerifyVerdict } from '@lobechat/types';

import type { VerifyCheckResultItem } from '@/database/schemas/verify';

export interface ReportStats {
  failed: number;
  passed: number;
  total: number;
  uncertain: number;
}

/**
 * A check a panel waived by an upheld dispute no longer counts, exactly as the
 * status rollup skips it, so the report can never read failed under a passed run.
 */
const countedResults = (results: VerifyCheckResultItem[]) =>
  results.filter((r) => !isCheckWaivedByDispute(r.metadata));

/**
 * Verdict-space rollup over a run's results, mirroring `VerifyStatusService`'s
 * gate so the report card can never disagree with the operation's verify_status.
 * Pure (no I/O) so it's unit-testable without the model-runtime chain.
 */
export const rollupVerdict = (results: VerifyCheckResultItem[]): VerifyVerdict => {
  const required = countedResults(results).filter((r) => r.required);
  const failed = (r: VerifyCheckResultItem) => r.status === 'failed' || r.verdict === 'failed';
  const unresolved = (r: VerifyCheckResultItem) => r.verdict === 'uncertain' || !r.verdict;

  if (required.some(failed)) return 'failed';
  if (required.some(unresolved)) return 'uncertain';
  return 'passed';
};

/** Verdict tallies for the report's statistics snapshot (unresolved → total only). */
export const countStats = (results: VerifyCheckResultItem[]): ReportStats => {
  const counted = countedResults(results);
  return {
    failed: counted.filter((r) => r.verdict === 'failed').length,
    passed: counted.filter((r) => r.verdict === 'passed').length,
    total: counted.length,
    uncertain: counted.filter((r) => r.verdict === 'uncertain').length,
  };
};

/** Mean of the present confidences, rounded to the column's 0.00–1.00 scale. */
export const meanConfidence = (results: VerifyCheckResultItem[]): number | null => {
  const values = results.map((r) => r.confidence).filter((c): c is number => typeof c === 'number');
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(mean * 100) / 100;
};
