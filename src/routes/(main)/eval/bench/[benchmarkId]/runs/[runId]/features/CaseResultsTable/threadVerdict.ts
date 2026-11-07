import type { EvalThreadResult } from '@lobechat/types';

export type ThreadVerdict =
  'completed' | 'error' | 'external' | 'failed' | 'passed' | 'pending' | 'running' | 'timeout';

/**
 * What one attempt of a pass@k case came to. A graded attempt keeps the status
 * `completed` and carries its verdict in `passed`, so `passed` decides before
 * `completed` does; `completed` alone means it finished but is not graded yet.
 */
export const threadVerdict = (
  thread: Pick<EvalThreadResult, 'error' | 'passed' | 'status'>,
): ThreadVerdict => {
  if (thread.status === 'running') return 'running';
  if (thread.status === 'external') return 'external';
  if (thread.status === 'timeout') return 'timeout';
  if (thread.error || thread.status === 'error' || thread.status === 'judge_error') return 'error';
  if (thread.passed === true) return 'passed';
  if (thread.passed === false) return 'failed';
  return thread.status === 'completed' ? 'completed' : 'pending';
};
