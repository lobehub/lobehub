import { isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import { buildAcceptanceRepairPrompt } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';
import type { AcceptanceService } from '@/server/services/verify';

import { assertCanUseWorkspaceAgent } from './workspaceAgentGuard';

const log = debug('lobe-server:acceptance-repair-dispatch');

/**
 * What a reject did beyond recording the decision.
 * - `no_origin`: the rounds carry no authoring conversation (e.g. an ingested
 *   report) — the reviewer hands the repair prompt over by hand.
 * - `origin_unavailable`: the conversation is gone, not the caller's, or has no
 *   agent to run.
 * - `failed`: the agent could not be started; the reject itself still stands.
 */
export type AcceptanceRepairDispatch =
  | { agentId: string; dispatched: true; operationId: string; topicId: string }
  | {
      dispatched: false;
      error?: string;
      reason: 'failed' | 'no_origin' | 'origin_unavailable' | 'skipped';
    };

interface DispatchContext {
  apiKeyScopes?: string[] | null;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Send a rejected delivery back to the agent that authored it: the repair
 * prompt becomes a user message in the origin topic and the agent runs — the
 * same channel `agentNotify.notify` gives remote callers. Best-effort by
 * design: the reject is already recorded, so a dispatch failure is reported,
 * never thrown.
 *
 * The topic is re-read under the CALLER's scope, so a reviewer who may manage
 * the acceptance but does not own its conversation cannot start someone
 * else's agent — they get `origin_unavailable` and fall back to the prompt.
 */
export const dispatchAcceptanceRepair = async (
  ctx: DispatchContext,
  service: AcceptanceService,
  acceptanceId: string,
): Promise<AcceptanceRepairDispatch> => {
  const origin = await service.findRepairOrigin(acceptanceId);
  if (!origin?.topicId) return { dispatched: false, reason: 'no_origin' };

  const workspaceId = ctx.workspaceId ?? undefined;
  const topic = await new TopicModel(ctx.serverDB, ctx.userId, workspaceId).findOwnTopicById(
    origin.topicId,
  );
  const agentId = origin.agentId ?? topic?.agentId ?? undefined;
  if (!topic || !agentId) return { dispatched: false, reason: 'origin_unavailable' };

  try {
    await assertCanUseWorkspaceAgent({
      agentId,
      db: ctx.serverDB,
      groupId: topic.groupId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });

    const result = await new AiAgentService(ctx.serverDB, ctx.userId, {
      withholdGatewayToken: ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes),
      workspaceId,
    }).execAgent({
      agentId,
      appContext: { topicId: topic.id },
      prompt: buildAcceptanceRepairPrompt(acceptanceId),
      trigger: RequestTrigger.Notify,
    });

    await service.acceptanceModel.updateStatus(acceptanceId, 'repairing');
    log('acceptance %s sent back to agent %s in topic %s', acceptanceId, agentId, topic.id);
    return { agentId, dispatched: true, operationId: result.operationId, topicId: topic.id };
  } catch (error) {
    console.error('[acceptance] repair dispatch failed for %s: %O', acceptanceId, error);
    return {
      dispatched: false,
      error: error instanceof Error ? error.message : String(error),
      reason: 'failed',
    };
  }
};
