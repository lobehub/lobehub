import { randomUUID } from 'node:crypto';

import debug from 'debug';

import { redisService } from '@/server/services/redis';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';
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
  const outcome = await queueRunSteer(ctx, {
    entry: {
      createdAt: Date.now(),
      id: randomUUID(),
      request: {
        agentId,
        appContext: { groupId: groupId ?? undefined, threadId, topicId },
        prompt: instruction,
      },
      subAgentSteer: true,
      userId: ctx.userId,
    },
    operationId,
    scope: { threadId, topicId, userId: ctx.userId },
  });
  if (outcome.queued) log('[%s] Queued a steer instruction for thread %s', operationId, threadId);
  return outcome;
};

/**
 * Queue an entry written for exactly one running run (`subAgentSteer` / `channelSteer`) and
 * settle whether that run will read it. A run that already took its last read gets the entry
 * taken back (`ended`), so the caller delivers it another way instead of leaving it behind a run
 * that will not read again.
 */
export const queueRunSteer = async (
  ctx: Pick<ComposerRunContext, 'db' | 'userId' | 'workspaceId'>,
  params: { entry: QueuedFollowUp; operationId: string; scope: SteerQueueScope },
): Promise<SubAgentSteerOutcome> => {
  const { entry, operationId, scope } = params;

  const appendOnce = async () => {
    try {
      return await redisService.steerQueue.append(scope, entry, operationId);
    } catch (error) {
      if (!(error instanceof SteerQueueWriteUnknownError)) throw error;
      log('[%s] Steer for topic %s may not be queued: %O', operationId, scope.topicId, error);
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
  // so the caller can deliver it another way; losing the take-back means the
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
      '[%s] Checking the steer for topic %s after queuing failed: %O',
      operationId,
      scope.topicId,
      error,
    );
    return { queued: false, reason: 'unknown' };
  }

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
