import type { AgentSenderMetadata, FollowUpMode } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import {
  collectMarkdownImageUrls,
  type InlineImage,
  resolveInlineImages,
} from '@/server/services/file/inlineImages';
import { redisService } from '@/server/services/redis';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';

import type { ComposerRunContext } from '../composerRun';
import { buildUserTurnMetadata } from '../pipeline/userTurnMetadata';
import {
  ackFollowUps,
  checkFollowUpAccess,
  drainOwnFollowUps,
  mergeQueuedFollowUps,
  type QueuedFollowUp,
  queuedUserMessageId,
  returnFollowUps,
  takeSameSenderFollowUps,
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
  /** Every follow-up merged into this delivery, when there were several (Steer mode). */
  entryIds?: string[];
  groupId?: string;
  scope: SteerQueueScope;
  trigger?: string;
}

export interface HeteroSteerMessage {
  content: string;
  /**
   * Images pasted into the follow-up's body, which `content` only holds as
   * markdown links: signed URLs for the session to take as image input.
   */
  imageList?: InlineImage[];
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

/** Whether a session that takes image input only if `acceptsImages` can take this follow-up now. */
const fitsSession = (entry: QueuedFollowUp, acceptsImages: boolean | undefined) =>
  acceptsImages || collectMarkdownImageUrls(entry.request.prompt).length === 0;

/**
 * Take the next follow-up queued behind a heterogeneous run for delivery into
 * its live session, in queue order: the first follow-up that cannot join (an
 * attachment, a tool selection…) stops the take, and it and everything behind
 * it wait for the run to end.
 *
 * In Steer mode (`mode: 'steer'`) every leading follow-up that can join, from
 * one author, goes as one merged message; otherwise one goes per delivery.
 * Either way the agent reads it when it is ready (Claude Code: at its next
 * tool boundary), so a running tool is never cut short.
 *
 * Images pasted into the body go along as `imageList` when the session takes
 * image input (`acceptsImages`). Otherwise the follow-up waits for a turn of
 * its own, where the dispatch hands them over: typed in as text, the agent
 * would only see links it cannot look at.
 *
 * @returns the message to send, or `undefined` when nothing can go now
 */
export const takeHeteroSteer = async (
  ctx: StoreContext,
  params: {
    acceptsImages?: boolean;
    agentId: string | null;
    mode?: FollowUpMode;
    operationId: string;
    scope: SteerQueueScope;
  },
): Promise<HeteroSteerMessage | undefined> => {
  const { acceptsImages, agentId, operationId, scope } = params;
  const merging = params.mode === 'steer';

  const drained = await drainOwnFollowUps(ctx, scope, operationId);
  if (drained.entries.length === 0) return;

  const held = await redisService.steerQueue.listHeteroDeliveries<HeteroSteerDelivery>(operationId);

  // A delivery whose lease lapsed while the session still held it came back
  // into the queue. It is the session's already: rebind it as it was, so a
  // merge with newer follow-ups (a new message id) never types its entries twice.
  const heldBy = new Map<string, string>();
  for (const [messageId, delivery] of Object.entries(held))
    for (const id of delivery.entryIds ?? [delivery.entryId]) heldBy.set(id, messageId);
  const lapsedId = drained.entries.map((entry) => heldBy.get(entry.id)).find(Boolean);
  if (lapsedId) {
    const delivery = held[lapsedId];
    const ids = new Set(delivery.entryIds ?? [delivery.entryId]);
    const others = drained.entries.filter((entry) => !ids.has(entry.id));
    await returnFollowUps(scope, drained, others, 'behind a delivery the session holds');
    await redisService.steerQueue.putHeteroDelivery(operationId, lapsedId, {
      ...delivery,
      drainId: drained.drainId,
    } satisfies HeteroSteerDelivery);
    return;
  }

  // A session that only takes text gets no image follow-up: decided from the
  // markdown alone, since the run asks again on every poll.
  const canGo = (entry: QueuedFollowUp) =>
    canSteerHeteroRun(entry, agentId) && fitsSession(entry, acceptsImages);
  const firstHeld = drained.entries.findIndex((entry) => !canGo(entry));
  const ready = firstHeld === -1 ? drained.entries : drained.entries.slice(0, firstHeld);
  const joining = merging ? takeSameSenderFollowUps(ready).taken : ready.slice(0, 1);
  if (joining.length === 0) {
    await returnFollowUps(scope, drained, drained.entries, 'needs a turn of its own');
    return;
  }

  const request = joining.length === 1 ? joining[0].request : mergeQueuedFollowUps(joining);
  let imageList: InlineImage[] = [];
  if (collectMarkdownImageUrls(request.prompt).length > 0) {
    try {
      imageList = await resolveInlineImages(ctx, request.prompt);
    } catch (error) {
      await returnFollowUps(scope, drained, drained.entries, error);
      return;
    }
  }
  const rest = drained.entries.filter((entry) => !joining.includes(entry));
  await returnFollowUps(
    scope,
    drained,
    rest,
    merging ? 'waits for the next join' : 'delivered one at a time',
  );

  const messageId = queuedUserMessageId(ctx.userId, joining, request);

  try {
    if ((await checkFollowUpAccess(ctx, request, scope)) === 'denied') {
      console.error('[takeHeteroSteer] dropped %d follow-ups: access revoked', joining.length);
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
      agentSender: joining[0].agentSender,
      content: request.prompt,
      drainId: drained.drainId,
      editorData: request.userMessage?.editorData,
      entryId: joining[0].id,
      ...(joining.length > 1 && { entryIds: joining.map((entry) => entry.id) }),
      groupId: request.appContext?.groupId ?? undefined,
      scope,
      trigger: request.trigger,
    } satisfies HeteroSteerDelivery);
  } catch (error) {
    await returnFollowUps(scope, drained, joining, error);
    return;
  }

  log('[%s] Delivering %d follow-ups as %s', operationId, joining.length, messageId);
  return {
    content: request.prompt,
    ...(imageList.length > 0 && { imageList }),
    messageId,
  };
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

  const entryIds = delivery.entryIds ?? [delivery.entryId];
  await returnFollowUps(
    delivery.scope,
    delivery,
    entryIds.map((id) => ({ id }) as QueuedFollowUp),
    {
      reason: 'the agent session no longer takes input',
    },
  );
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
