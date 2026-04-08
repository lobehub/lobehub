import type { EvalRunTopicResult } from '@lobechat/types';

const RESUMABLE_STATUSES = new Set(['error', 'timeout']);

interface RunResultRecord {
  evalResult?: EvalRunTopicResult | null;
  status?: string | null;
}

export interface ResumeTarget {
  resumeStatus?: 'error' | 'timeout';
  threadId?: string;
}

export const getResumeTarget = (result: RunResultRecord, k: number): ResumeTarget | undefined => {
  if (k <= 1) {
    if (!RESUMABLE_STATUSES.has(result.status ?? '')) return undefined;

    return { resumeStatus: result.status as 'error' | 'timeout' };
  }

  const thread = result.evalResult?.threads?.find((item) =>
    RESUMABLE_STATUSES.has(item.status ?? ''),
  );

  if (!thread?.status) return undefined;

  return {
    resumeStatus: thread.status as 'error' | 'timeout',
    threadId: thread.threadId,
  };
};
