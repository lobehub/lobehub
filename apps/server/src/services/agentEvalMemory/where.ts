import type { EvalMemoryReference } from '@lobechat/types';
import { and, eq, isNull, type SQL } from 'drizzle-orm';

import { agentEvalMemories } from '@/database/schemas';
import { getEvalAttemptId } from '@/server/services/agentEvalRun/utils';

/** Rows of one attempt owned by this caller; removed entries stay out unless asked for. */
export const attemptWhere = (
  userId: string,
  reference: Pick<EvalMemoryReference, 'runId' | 'threadId' | 'topicId'>,
  options: { includeRemoved?: boolean } = {},
): SQL =>
  and(
    eq(agentEvalMemories.userId, userId),
    eq(agentEvalMemories.runId, reference.runId),
    // Keep deleted-thread evidence out of the parent attempt's null-thread scope.
    eq(agentEvalMemories.attemptId, getEvalAttemptId(reference)),
    eq(agentEvalMemories.topicId, reference.topicId),
    reference.threadId
      ? eq(agentEvalMemories.threadId, reference.threadId)
      : isNull(agentEvalMemories.threadId),
    options.includeRemoved ? undefined : isNull(agentEvalMemories.removedReason),
  ) as SQL;
