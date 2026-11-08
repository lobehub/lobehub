import type { AgentSenderMetadata } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { redisService } from '@/server/services/redis';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';

import type { ComposerRunContext } from '../composerRun';
import { buildUserTurnMetadata } from '../pipeline/userTurnMetadata';
import {
  ackFollowUps,
  checkFollowUpAccess,
  drainOwnFollowUps,
  type QueuedFollowUp,
  queuedUserMessageId,
  returnFollowUps,
} from './index';

const log = debug('lobe-server:steer-queue:hetero');

type StoreContext = Pick<ComposerRunContext, 'db' | 'userId' | 'workspaceId'>;

/**
 * A follow-up a heterogeneous run took into its live agent session. Its
 * drained batch stays leased (renewed while the run polls) until the agent
 * replays the message, so a run that dies holding it puts it back in the queue.
 */
export interface HeteroSteerDelivery {
  agentSender?: AgentSenderMetadata;
  content: string;
  drainId: string;
  editorData?: unknown;
  entryId: string;
  groupId?: string;
  scope: SteerQueueScope;
  trigger?: string;
}

export interface HeteroSteerMessage {
  content: string;
  messageId: string;
}

/**
 * Whether a follow-up can be typed into the running agent session: plain text
 * for the same agent. Attachments, attached selections, tool or skill
 * selections and @-mentions need a turn configured for them, and wait for the
 * run to end.
 */
export const canSteerHeteroRun = (entry: QueuedFollowUp, agentId: string | null): boolean => {
  const { request } = entry;
  if (!request.prompt.trim()) return false;
  if (request.fileIds?.length) return false;
  if (request.userMessage?.metadata) return false;
  if (request.selectedToolIds?.length || request.selectedSkillIds?.length) return false;
  if (request.mentionedAgents?.length) return false;
  return !!agentId && request.agentId === agentId;
};

/**
 * Keeps the leases of the deliveries the run still holds from lapsing. Called
 * on every poll, so they lapse back into the queue only when the run stops
 * polling (it died) for longer than a lease.
 */
export const renewHeteroSteers = async (operationId: string) => {
  const held = await redisService.steerQueue.listHeteroDeliveries<HeteroSteerDelivery>(operationId);
  for (const delivery of Object.values(held)) {
    await redisService.steerQueue.renew(delivery.scope, delivery.drainId).catch((error) => {
      log('[%s] renewing batch %s failed: %O', operationId, delivery.drainId, error);
    });
  }
};

/**
 * Take the next follow-up queued behind a heterogeneous run for delivery into
 * its live session. One message per delivery, in queue order: the first
 * follow-up that cannot join (an attachment, a tool selection…) stops the
 * take, and it and everything behind it wait for the run to end.
 *
 * @returns the message to send, or `undefined` when nothing can go now
 */
export const takeHeteroSteer = async (
  ctx: StoreContext,
  params: { agentId: string | null; operationId: string; scope: SteerQueueScope },
): Promise<HeteroSteerMessage | undefined> => {
  const { agentId, operationId, scope } = params;

  const drained = await drainOwnFollowUps(ctx, scope, operationId);
  if (drained.entries.length === 0) return;

  const held = await redisService.steerQueue.listHeteroDeliveries<HeteroSteerDelivery>(operationId);

  const [first, ...rest] = drained.entries;
  if (!canSteerHeteroRun(first, agentId)) {
    await returnFollowUps(scope, drained, drained.entries, 'needs a turn of its own');
    return;
  }
  await returnFollowUps(scope, drained, rest, 'delivered one at a time');

  const request = first.request;
  const messageId = queuedUserMessageId(ctx.userId, [first], request);

  try {
    if ((await checkFollowUpAccess(ctx, request, scope)) === 'denied') {
      console.error('[takeHeteroSteer] dropped follow-up %s: access revoked', first.id);
      await ackFollowUps(scope, drained);
      return;
    }

    // Lapsed back after an earlier delivery: the session already has it.
    // Keep holding it under the new batch instead of sending it twice.
    const earlier = held[messageId];
    if (earlier) {
      await redisService.steerQueue.putHeteroDelivery(operationId, messageId, {
        ...earlier,
        drainId: drained.drainId,
      } satisfies HeteroSteerDelivery);
      return;
    }

    const messageModel = new MessageModel(ctx.db, ctx.userId, ctx.workspaceId ?? undefined);
    if (await messageModel.findById(messageId)) {
      await ackFollowUps(scope, drained);
      return;
    }

    await redisService.steerQueue.putHeteroDelivery(operationId, messageId, {
      agentSender: first.agentSender,
      content: request.prompt,
      drainId: drained.drainId,
      editorData: request.userMessage?.editorData,
      entryId: first.id,
      groupId: request.appContext?.groupId ?? undefined,
      scope,
      trigger: request.trigger,
    } satisfies HeteroSteerDelivery);
  } catch (error) {
    await returnFollowUps(scope, drained, [first], error);
    return;
  }

  log('[%s] Delivering follow-up %s as %s', operationId, first.id, messageId);
  return { content: request.prompt, messageId };
};

/**
 * The session could not take a delivered message (its input already closed):
 * put the follow-up back in the queue, where it starts the next turn when the
 * run ends.
 */
export const returnHeteroSteer = async (operationId: string, messageId: string) => {
  const held = await redisService.steerQueue.listHeteroDeliveries<HeteroSteerDelivery>(operationId);
  const delivery = held[messageId];
  if (!delivery) return;

  await returnFollowUps(delivery.scope, delivery, [{ id: delivery.entryId } as QueuedFollowUp], {
    reason: 'the agent session no longer takes input',
  });
  await redisService.steerQueue.removeHeteroDelivery(operationId, messageId);
};

/**
 * Put back every delivery the run never picked up. Called when it finishes,
 * before its queue is drained into the next turn.
 */
export const releaseHeteroSteers = async (operationId: string) => {
  const held = await redisService.steerQueue.listHeteroDeliveries<HeteroSteerDelivery>(operationId);
  for (const messageId of Object.keys(held)) {
    await returnHeteroSteer(operationId, messageId).catch((error) => {
      console.error('[releaseHeteroSteers] returning %s failed: %O', messageId, error);
    });
  }
};

/**
 * The agent replayed a delivered message: write it into the conversation as a
 * steer user message under `parentId`, and acknowledge its follow-up.
 * Idempotent: a retried batch finds the message already written.
 *
 * @returns the user message, or `undefined` when `messageId` is not a
 * delivery of this run (the initial prompt is replayed too)
 */
export const consumeHeteroSteer = async (
  messageModel: MessageModel,
  params: {
    agentId?: string | null;
    operationId: string;
    parentId: string;
    threadId?: string | null;
    topicId: string;
    messageId: string;
  },
): Promise<
  | { content: string; id: string; metadata: Record<string, unknown>; parentId: string | null }
  | undefined
> => {
  const { messageId, operationId } = params;
  const held = await redisService.steerQueue.listHeteroDeliveries<HeteroSteerDelivery>(operationId);
  const delivery = held[messageId];

  if (!delivery) {
    const written = await messageModel.findById(messageId);
    if (written?.role !== 'user' || written.topicId !== params.topicId) return;
    return {
      content: written.content ?? '',
      id: written.id,
      metadata: (written.metadata ?? {}) as Record<string, unknown>,
      parentId: written.parentId ?? null,
    };
  }

  const metadata = {
    ...buildUserTurnMetadata({
      agentSender: delivery.agentSender,
      steer: true,
      trigger: delivery.trigger ?? RequestTrigger.Chat,
    }),
    // Stamped like the run's own rows, so a cold replica recovers it as the spine.
    operationId,
  };

  if (!(await messageModel.findById(messageId))) {
    await messageModel.create(
      {
        agentId: params.agentId ?? undefined,
        content: delivery.content,
        editorData: delivery.editorData,
        groupId: delivery.groupId,
        metadata,
        parentId: params.parentId,
        role: 'user',
        threadId: params.threadId ?? undefined,
        topicId: params.topicId,
      } as any,
      messageId,
    );
  }

  await ackFollowUps(delivery.scope, delivery);
  await redisService.steerQueue.removeHeteroDelivery(operationId, messageId);

  return { content: delivery.content, id: messageId, metadata, parentId: params.parentId };
};
