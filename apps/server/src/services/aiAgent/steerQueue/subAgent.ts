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
   * was not stored and nothing will deliver it.
   */
  | { queued: false; reason: 'ended' | 'full' | 'unavailable' };

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

  let length: Awaited<ReturnType<typeof redisService.steerQueue.append>>;
  try {
    length = await redisService.steerQueue.append(scope, entry, operationId);
  } catch (error) {
    if (!(error instanceof SteerQueueWriteUnknownError)) throw error;
    log('[%s] Steer for thread %s may not be queued: %O', operationId, threadId, error);
    return { queued: false, reason: 'unavailable' };
  }
  if (length === 'full') return { queued: false, reason: 'full' };
  if (length === undefined || length === 'notStored') {
    return { queued: false, reason: 'unavailable' };
  }

  // The run may have ended between the caller's check and the append, after
  // its last chance to read the queue. Take the entry back so the caller can
  // start a new run with it; losing the take-back means the run already took it.
  if (
    !(await isRunAlive({ db: ctx.db, workspaceId: ctx.workspaceId }, ctx.userId, operationId)) &&
    (await redisService.steerQueue.remove(scope, entry.id))
  ) {
    return { queued: false, reason: 'ended' };
  }

  log('[%s] Queued a steer instruction for thread %s', operationId, threadId);
  return { queued: true };
};
