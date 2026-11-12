import type { AgentEvalRunTopicResult, EvalRuleVerdict, EvalRunTopicResult } from '@lobechat/types';

// ---------- attempts ----------

export type AttemptVerdict =
  'error' | 'failed' | 'judge_error' | 'passed' | 'pending' | 'running' | 'timeout';

export interface CaseAttempt {
  cost?: number;
  duration?: number;
  error?: string;
  passCount: number;
  reason?: string;
  score?: number;
  threads: Array<{ status: AttemptVerdict; threadId?: string }>;
  toolCalls?: number;
  total: number;
  verdict: AttemptVerdict;
  /** Per-rule verdicts when the case is graded as a rule checklist. */
  verdicts?: EvalRuleVerdict[];
}

const asVerdict = (
  status?: string | null,
  passed?: boolean | null,
  errorPhase?: string,
): AttemptVerdict => {
  if (errorPhase === 'judge') return 'judge_error';
  switch (status) {
    case 'completed': {
      return typeof passed === 'boolean' ? (passed ? 'passed' : 'failed') : 'pending';
    }
    case 'passed':
    case 'failed':
    case 'error':
    case 'judge_error':
    case 'timeout':
    case 'running': {
      return status;
    }
    default: {
      return 'pending';
    }
  }
};

/** One contender's attempt(s) at one case, from the run's per-topic result. */
export const summarizeCaseResult = (
  result: AgentEvalRunTopicResult | undefined,
  k: number,
): CaseAttempt => {
  const evalResult = (result?.evalResult ?? undefined) as EvalRunTopicResult | undefined;
  const threads = evalResult?.threads ?? [];
  const verdict = threads.some(
    (thread) => asVerdict(thread.status, thread.passed) === 'judge_error',
  )
    ? 'judge_error'
    : asVerdict(result?.status, result?.passed, evalResult?.errorPhase);
  if (threads.length > 0) {
    const passCount = threads.filter(
      (thread) => asVerdict(thread.status, thread.passed) === 'passed',
    ).length;
    const first = threads[0];
    const judgeFailure = threads.find((thread) => thread.status === 'judge_error');
    return {
      cost: evalResult?.totalCost ?? evalResult?.cost,
      duration: evalResult?.duration,
      error:
        evalResult?.judgeError ??
        judgeFailure?.judgeError ??
        evalResult?.error ??
        judgeFailure?.error,
      passCount,
      reason: first?.rubricScores?.[0]?.reason ?? evalResult?.rubricScores?.[0]?.reason,
      score: verdict === 'judge_error' ? undefined : (result?.score ?? undefined),
      threads: threads.map((thread) => ({
        status: asVerdict(thread.status, thread.passed),
        threadId: thread.threadId,
      })),
      toolCalls: evalResult?.toolCalls,
      total: Math.max(k, threads.length),
      verdict,
      verdicts: first?.rubricScores?.[0]?.verdicts ?? evalResult?.rubricScores?.[0]?.verdicts,
    };
  }
  return {
    cost: evalResult?.cost,
    duration: evalResult?.duration,
    error: evalResult?.judgeError ?? evalResult?.error,
    passCount: verdict === 'passed' ? 1 : 0,
    reason: evalResult?.rubricScores?.[0]?.reason,
    score: verdict === 'judge_error' ? undefined : (result?.score ?? undefined),
    threads: [{ status: verdict }],
    toolCalls: evalResult?.toolCalls,
    total: k,
    verdict,
    verdicts: evalResult?.rubricScores?.[0]?.verdicts,
  };
};

export const formatCost = (value?: number, digits = 3) =>
  value === undefined ? '—' : `$${value.toFixed(digits)}`;
