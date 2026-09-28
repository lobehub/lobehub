import { buildAcceptanceRepairPrompt } from '@lobechat/prompts';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { GoalModel } from '@/database/models/goal';
import { TopicModel } from '@/database/models/topic';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import type { AcceptanceService } from '@/server/services/verify';

import { agentNotifyRouter } from '../agentNotify';

const log = debug('lobe-server:acceptance-repair-dispatch');

/**
 * What a reject did beyond recording the decision.
 * - `no_origin`: the rounds carry no authoring conversation (e.g. an ingested
 *   report) — the reviewer hands the repair prompt over by hand.
 * - `origin_unavailable`: the conversation is gone, not the caller's, or has no
 *   agent to run.
 * - `forbidden`: the caller may review the delivery but not write to the
 *   conversation or run its agent.
 * - `goal_coordinator`: a Goal Task — its coordinator starts the next attempt.
 * - `failed`: the agent could not be started; the reject itself still stands.
 */
export type AcceptanceRepairDispatch =
  | { agentId: string; dispatched: true; operationId: string; topicId: string }
  | {
      dispatched: false;
      error?: string;
      reason:
        | 'failed'
        | 'forbidden'
        | 'goal_coordinator'
        | 'no_origin'
        | 'origin_unavailable'
        | 'skipped';
    };

/** The caller's request context — handed to `agentNotify.notify` unchanged. */
type DispatchContext = Exclude<
  Parameters<typeof agentNotifyRouter.createCaller>[0],
  (...args: never[]) => unknown
> & { serverDB: LobeChatDatabase; userId: string; workspaceId?: string | null };

/**
 * Send a rejected delivery back to the agent that authored it: the repair
 * prompt becomes a user message in the origin topic and the agent runs.
 *
 * The send goes through `agentNotify.notify` itself rather than a copy of its
 * side effect, so it carries the same gates — the conversation-write
 * permission (`message:create`), the workspace agent-use ACL and the caller's
 * own topic scope. A reviewer who may manage the acceptance but not run its
 * agent gets `forbidden` / `origin_unavailable` and falls back to the prompt.
 *
 * Best-effort by design: the reject is already recorded, so a dispatch failure
 * is reported, never thrown.
 */
export const dispatchAcceptanceRepair = async (
  ctx: DispatchContext,
  service: AcceptanceService,
  acceptance: AcceptanceItem,
  rejectComment?: string,
): Promise<AcceptanceRepairDispatch> => {
  // A Goal Task's next attempt belongs to its coordinator, which reads the
  // rejected round through the prompt builder and claims the task. A plain
  // run in the old topic would race it into a second, unaccounted attempt.
  if (acceptance.subjectType === 'task') {
    const goal = await new GoalModel(
      ctx.serverDB,
      acceptance.userId,
      acceptance.workspaceId ?? undefined,
    ).findByGraphTask(acceptance.subjectId);
    if (goal) return { dispatched: false, reason: 'goal_coordinator' };
  }

  const origin = await service.findRepairOrigin(acceptance.id);
  if (!origin?.topicId) return { dispatched: false, reason: 'no_origin' };

  const topic = await new TopicModel(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId ?? undefined,
  ).findOwnTopicById(origin.topicId);
  const agentId = origin.agentId ?? topic?.agentId ?? undefined;
  if (!topic || !agentId) return { dispatched: false, reason: 'origin_unavailable' };

  let operationId: string | undefined;
  try {
    ({ operationId } = await agentNotifyRouter.createCaller(ctx).notify({
      agentId,
      content: buildAcceptanceRepairPrompt(acceptance.id, rejectComment),
      role: 'user',
      topicId: topic.id,
    }));
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'FORBIDDEN') {
      return { dispatched: false, reason: 'forbidden' };
    }
    console.error('[acceptance] repair dispatch failed for %s: %O', acceptance.id, error);
    return {
      dispatched: false,
      error: error instanceof Error ? error.message : String(error),
      reason: 'failed',
    };
  }
  if (!operationId) {
    return { dispatched: false, error: 'The agent run did not start', reason: 'failed' };
  }

  // The run is live from here: a failed `repairing` stamp must not read as a
  // failed dispatch, or the caller would retry into a duplicate run. The
  // aggregate converges when the repair round lands.
  try {
    await service.acceptanceModel.updateStatus(acceptance.id, 'repairing');
  } catch (error) {
    console.error('[acceptance] marking %s repairing failed: %O', acceptance.id, error);
  }

  log('acceptance %s sent back to agent %s in topic %s', acceptance.id, agentId, topic.id);
  return { agentId, dispatched: true, operationId, topicId: topic.id };
};
