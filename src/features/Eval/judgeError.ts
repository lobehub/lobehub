interface JudgeResult {
  error?: string;
  errorPhase?: string;
  judgeError?: string;
}

/** A Judge fault is a diagnostic about grading, not a zero-score candidate answer. */
export const getJudgeFailure = (status: string | null | undefined, result?: JudgeResult | null) =>
  status === 'judge_error' || result?.errorPhase === 'judge'
    ? { diagnostic: result?.judgeError ?? result?.error }
    : undefined;
