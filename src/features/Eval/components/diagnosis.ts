/**
 * What one frozen call replayed on several models says about where a bad
 * answer comes from.
 *
 * - `harness`: every judged model failed — the same context breaks them all,
 *   so fix the prompt / context / tools before swapping models.
 * - `model`: some passed and some failed — the context can be answered, so
 *   this is a model-choice problem.
 * - `pass`: every judged model passed.
 * - `inconclusive`: fewer than two models were judged (errors and pending
 *   cells say nothing about the case), so there is nothing to compare yet.
 */
export type CaseDiagnosis = 'harness' | 'inconclusive' | 'model' | 'pass';

export interface DiagnosisCell {
  passed?: boolean | null;
  status: string;
}

export interface CaseDiagnosisResult {
  diagnosis: CaseDiagnosis;
  failed: number;
  judged: number;
  passed: number;
}

export const MIN_JUDGED_MODELS = 2;

export const diagnoseCase = (cells: DiagnosisCell[]): CaseDiagnosisResult => {
  const judged = cells.filter((c) => c.status === 'completed' && typeof c.passed === 'boolean');
  const passed = judged.filter((c) => c.passed).length;
  const failed = judged.length - passed;

  const diagnosis: CaseDiagnosis =
    judged.length < MIN_JUDGED_MODELS
      ? 'inconclusive'
      : passed === 0
        ? 'harness'
        : failed === 0
          ? 'pass'
          : 'model';

  return { diagnosis, failed, judged: judged.length, passed };
};
