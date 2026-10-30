import type { AgentState } from '@lobechat/agent-runtime';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';

import type { ComposerRunContext } from '../composerRun';
import { createUserTurnAnchor } from '../pipeline/resolveUserMessageParentId';
import { buildUserTurnMetadata } from '../pipeline/userTurnMetadata';
import {
  ackFollowUps,
  checkFollowUpAccess,
  drainOwnFollowUps,
  mergeQueuedFollowUps,
  type QueuedFollowUp,
  returnFollowUps,
  takeSameSenderFollowUps,
} from './index';

const log = debug('lobe-server:steer-queue');

/** Key-order-independent form of a settings value, for comparing two of them. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/**
 * Whether the per-turn settings a follow-up was sent with are the ones the
 * running turn already uses. A joined follow-up only adds a message — it runs
 * on the run's device, executor, protocol and approval settings — so any
 * setting it states must match them; one it leaves out is inherited either
 * way.
 */
const matchesRunningTurnSettings = (
  request: QueuedFollowUp['request'],
  state: AgentState,
): boolean => {
  const runDeviceId = state.binding?.device?.id;
  if (request.deviceId && request.deviceId !== runDeviceId) return false;
  if (request.localDeviceId && request.localDeviceId !== runDeviceId) return false;

  if (request.clientProtocol && request.clientProtocol !== (state.host?.clientProtocol ?? 1)) {
    return false;
  }
  if (!!request.acceptsFileWorks !== !!state.host?.acceptsFileWorks) return false;

  if (request.llmExecutor) {
    // `channelOperationId` is server-set on the run's executor, never sent by a client.
    const { channelOperationId: _channel, ...runExecutor } = (state.host?.llmExecutor ??
      {}) as Record<string, unknown>;
    if (canonical(request.llmExecutor) !== canonical(runExecutor)) return false;
  }

  if (request.userInterventionConfig) {
    const runIntervention =
      state.principal?.policy?.userIntervention ?? state.userInterventionConfig;
    if (canonical(request.userInterventionConfig) !== canonical(runIntervention)) return false;
  }

  return true;
};

/**
 * Whether a follow-up can join the run that is already going: plain text for
 * the same agent, sent with the turn settings the run already has. Anything
 * that needs a turn configured for it — attachments, attached selections, tool or skill selections,
 * @-mentions, another agent, a different device, executor, protocol or approval
 * setting — waits for the hand-back and starts as the next turn instead.
 */
export const canJoinRunningTurn = (entry: QueuedFollowUp, state: AgentState): boolean => {
  const { request } = entry;
  if (!request.prompt.trim()) return false;
  if (request.fileIds?.length) return false;
  // Attached content is injected per user message; a steer message joins a
  // turn whose context is already built.
  if (request.userMessage?.metadata) return false;
  if (request.selectedToolIds?.length || request.selectedSkillIds?.length) return false;
  if (request.mentionedAgents?.length) return false;

  const runAgentId = state.origin?.agentId;
  if (!request.agentId || !runAgentId || request.agentId !== runAgentId) return false;

  return matchesRunningTurnSettings(request, state);
};

/**
 * The run is at a decision point right before its next LLM call: take the
 * follow-ups queued behind it into the run as one steer user message, anchored
 * where a composer send would anchor it, so the model reads them on this very
 * step. The leading follow-ups that can join are taken (queue order is kept);
 * the rest go back to the head of the queue for the hand-back.
 *
 * @returns the persisted user message, or `undefined` when nothing joined
 */
export const injectQueuedFollowUp = async (
  ctx: Pick<ComposerRunContext, 'db' | 'userId' | 'workspaceId'>,
  params: { operationId: string; scope: SteerQueueScope; state: AgentState },
): Promise<{ messageId: string } | undefined> => {
  const { operationId, scope, state } = params;

  const drained = await drainOwnFollowUps(ctx, scope, operationId);
  const { entries } = drained;
  if (entries.length === 0) return;

  const firstHeld = entries.findIndex((entry) => !canJoinRunningTurn(entry, state));
  const joinable = firstHeld === -1 ? entries : entries.slice(0, firstHeld);
  // One author per message: a different sender's follow-ups wait their turn.
  const { agentSender, taken: joining } = takeSameSenderFollowUps(joinable);
  const held = entries.filter((entry) => !joining.includes(entry));
  // Back at the head, for the hand-back at the next decision point. Should
  // that fail, they stay in the batch and return when it lapses.
  await returnFollowUps(scope, drained, held, 'needs a turn of its own');
  if (joining.length === 0) return;

  const request = mergeQueuedFollowUps(joining);

  try {
    if ((await checkFollowUpAccess(ctx, request, scope)) === 'denied') {
      console.error(
        '[injectQueuedFollowUp] dropped %d queued follow-ups for %s: access revoked',
        joining.length,
        operationId,
      );
      await ackFollowUps(scope, drained);
      return;
    }

    const messageModel = new MessageModel(ctx.db, ctx.userId, ctx.workspaceId ?? undefined);
    const groupId = request.appContext?.groupId ?? undefined;
    const parentId = await createUserTurnAnchor(messageModel, {
      allowShareVisitor: false,
      groupId,
      threadId: scope.threadId ?? null,
      topicId: scope.topicId,
    }).resolveParentId();

    const message = await messageModel.create({
      agentId: state.origin?.agentId,
      content: request.prompt,
      editorData: request.userMessage?.editorData,
      groupId,
      metadata: buildUserTurnMetadata({
        agentSender,
        steer: true,
        trigger: request.trigger ?? RequestTrigger.Chat,
      }),
      parentId,
      role: 'user',
      threadId: scope.threadId ?? undefined,
      topicId: scope.topicId,
    });

    log('[%s] Joined %d queued follow-ups as %s', operationId, joining.length, message.id);
    await ackFollowUps(scope, drained);
    return { messageId: message.id };
  } catch (error) {
    await returnFollowUps(scope, drained, joining, error);
    return;
  }
};
