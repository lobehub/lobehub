import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { redisService } from '@/server/services/redis';
import { SteerQueueWriteUnknownError } from '@/server/services/redis/steerQueue';

import type { ComposerRunContext } from '../composerRun';
import type { QueuedFollowUp } from './index';
import { isRunAlive } from './liveRuns';

const log = debug('lobe-server:steer-queue');

export type SubAgentSteerOutcome =
  | { queued: true }
  /**
   * `ended`: the run finished before the instruction was stored, so the caller
   * continues the thread with a new run instead. `full` / `unavailable`: it
   * was not stored and nothing will deliver it. `unknown`: the write failed
   * twice and may still have landed, or it landed and the check after it
   * failed — the run may already be following it, so sending it again could
   * run it twice.
   */
  | { queued: false; reason: 'ended' | 'full' | 'unavailable' | 'unknown' };

/**
 * Queue a parent agent's new instruction behind its running `callSubAgent`
 * child, on the child's isolation thread. The child's step loop takes it in
 * before its next LLM call (`injectQueuedFollowUp`), the same way a running
 * conversation takes in a follow-up the user typed behind it.
 */
export const queueSubAgentSteer = async (
  ctx: Pick<ComposerRunContext, 'db' | 'userId' | 'workspaceId'>,
  params: {
    agentId: string;
    groupId?: string | null;
    instruction: string;
    operationId: string;
    threadId: string;
    topicId: string;
  },
): Promise<SubAgentSteerOutcome> => {
  const { agentId, groupId, instruction, operationId, threadId, topicId } = params;
  const scope = { threadId, topicId, userId: ctx.userId };
  const entry: QueuedFollowUp = {
    createdAt: Date.now(),
    id: randomUUID(),
    request: {
      agentId,
      appContext: { groupId: groupId ?? undefined, threadId, topicId },
      prompt: instruction,
    },
    subAgentSteer: true,
    userId: ctx.userId,
  };

  const appendOnce = async () => {
    try {
      return await redisService.steerQueue.append(scope, entry, operationId);
    } catch (error) {
      if (!(error instanceof SteerQueueWriteUnknownError)) throw error;
      log('[%s] Steer for thread %s may not be queued: %O', operationId, threadId, error);
      return 'unknown' as const;
    }
  };

  // A timed-out write may still have landed. Retrying with the same entry id
  // appends at most once, so it settles the outcome without a duplicate.
  let length = await appendOnce();
  const uncertain = length === 'unknown';
  if (uncertain) length = await appendOnce();
  if (length === 'unknown') return { queued: false, reason: 'unknown' };
  // A retry that finds the entry already taken: the run read the earlier write.
  if (length === 'taken') return { queued: true };
  if (length === 'full') return { queued: false, reason: 'full' };
  if (length === undefined || length === 'notStored') {
    // After an unknown write, no Redis on the retry proves nothing either way.
    return { queued: false, reason: uncertain && length === undefined ? 'unknown' : 'unavailable' };
  }

  // The run may have ended between the caller's check and the append, after
  // its last chance to read the queue: it seals itself before its final read
  // (`steerQueue.seal`), or its row already says it ended. Take the entry back
  // so the caller can start a new run with it; losing the take-back means the
  // run already took it. The entry is stored by now, so a check that fails
  // leaves it unknown whether the run follows it: a resend could run it twice.
  try {
    if (
      (await isPastLastRead(ctx, operationId)) &&
      (await redisService.steerQueue.remove(scope, entry.id))
    ) {
      return { queued: false, reason: 'ended' };
    }
  } catch (error) {
    log(
      '[%s] Checking the steer for thread %s after queuing failed: %O',
      operationId,
      threadId,
      error,
    );
    return { queued: false, reason: 'unknown' };
  }

  log('[%s] Queued a steer instruction for thread %s', operationId, threadId);
  return { queued: true };
};

/** A seal that cannot be read counts as set: taking the entry back is the safe side. */
const isPastLastRead = async (
  ctx: Pick<ComposerRunContext, 'db' | 'userId' | 'workspaceId'>,
  operationId: string,
): Promise<boolean> => {
  const sealed = await redisService.steerQueue.isSealed(operationId).catch(() => true);
  if (sealed !== false) return true;

  return !(await isRunAlive({ db: ctx.db, workspaceId: ctx.workspaceId }, ctx.userId, operationId));
};
