import { ThreadStatus } from '@lobechat/types';
import debug from 'debug';

import { ThreadModel } from '@/database/models/thread';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:completion-lifecycle');

/** Thread status an operation's terminal reason leaves its isolation thread in. */
export const threadStatusForReason = (reason: string): ThreadStatus => {
  switch (reason) {
    case 'error':
    case 'timeout': {
      return ThreadStatus.Failed;
    }
    case 'interrupted': {
      return ThreadStatus.Cancel;
    }
    case 'waiting_for_human': {
      return ThreadStatus.InReview;
    }
    default: {
      return ThreadStatus.Completed;
    }
  }
};

/**
 * Settle the thread an operation ran in. The thread run hooks that used to
 * own this are in-process handlers, which queue mode never invokes, so every
 * isolation thread (sub-agents, group members) stayed `processing` after its
 * run ended. This runs on every terminal transition in both modes; in local
 * mode the richer handler write still lands after it. Non-fatal.
 */
export const settleOperationThread = async (params: {
  db: LobeChatDatabase;
  error?: unknown;
  operationId: string;
  reason: string;
  userId: string;
  workspaceId?: string;
}): Promise<void> => {
  const { db, error, operationId, reason, userId, workspaceId } = params;
  const status = threadStatusForReason(reason);
  try {
    const threadId = await new ThreadModel(db, userId, workspaceId).settleForOperation(
      operationId,
      status,
      status === ThreadStatus.InReview
        ? {}
        : {
            completedAt: new Date().toISOString(),
            ...(status === ThreadStatus.Failed && error !== undefined && { error }),
          },
    );
    if (threadId) log('[%s] settled thread %s → %s', operationId, threadId, status);
  } catch (e) {
    log('[%s] failed to settle operation thread (non-fatal): %O', operationId, e);
  }
};
