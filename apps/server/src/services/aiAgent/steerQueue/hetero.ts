import type { AgentSenderMetadata, ChatImageItem } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { isModelImageFileType } from '@/database/models/message/attachments';
import { getFileProxyUrl } from '@/server/services/file';
import {
  collectMarkdownImageUrls,
  type InlineImage,
  resolveInlineImages,
} from '@/server/services/file/inlineImages';
import { resolveAttachmentMetadata } from '@/server/services/file/resolveAttachments';
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
import { isRunAlive } from './liveRuns';

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
  /** Every follow-up merged into this delivery, when there were several. */
  entryIds?: string[];
  fileIds?: string[];
  groupId?: string;
  scope: SteerQueueScope;
  trigger?: string;
}

export interface HeteroSteerMessage {
  content: string;
  /** Signed URLs for uploaded attachments and images linked from the body. */
  imageList?: InlineImage[];
  messageId: string;
  /** An upload is part of the message; a producer must return it if the image fails. */
  requiresImages?: true;
}

/**
 * Whether a follow-up can use the existing session's configuration. Uploaded
 * files also need a producer that takes attachments and a successful image lookup.
 */
export const canSteerHeteroRun = (
  entry: QueuedFollowUp,
  agentId: string | null,
  acceptsImageAttachments = false,
): boolean => {
  const { request } = entry;
  if (!request.prompt.trim()) return false;
  if (request.fileIds?.length && !acceptsImageAttachments) return false;
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
 * Hold a delivery for the run, unless the run ended meanwhile: then put it
 * back in the queue and report that it is not held.
 *
 * A poll can outlive the producer that sent it (a host that does not cancel a
 * request when its client disconnects keeps the long-poll running), and take
 * the follow-ups the run's end just returned. Nothing would renew or return
 * that hold, so they would read as being delivered, and hold every later send
 * behind them, until their lease lapsed. A run's end writes its terminal
 * status before it releases what the run holds, and this writes the hold
 * before it reads the status: either the release finds this hold, or this
 * read finds the end.
 *
 * @returns whether the run holds the delivery
 */
const holdHeteroDelivery = async (
  ctx: StoreContext,
  operationId: string,
  messageId: string,
  delivery: HeteroSteerDelivery,
): Promise<boolean> => {
  await redisService.steerQueue.putHeteroDelivery(operationId, messageId, delivery);
  const alive = await isRunAlive(ctx, ctx.userId, operationId).catch((error) => {
    // Unknown: keep the hold, whose lease still puts it back if the run is gone.
    log('[%s] checking the run before holding %s failed: %O', operationId, messageId, error);
    return true;
  });
  if (alive) return true;

  log('[%s] run ended meanwhile, putting %s back', operationId, messageId);
  await returnHeteroSteer(operationId, messageId);
  return false;
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
 * Every leading follow-up that can join, from one author, goes as one merged
 * message. The agent reads it when it is ready (Claude Code: at its next
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
    acceptsImageAttachments?: boolean;
    acceptsImages?: boolean;
    agentId: string | null;
    operationId: string;
    scope: SteerQueueScope;
  },
): Promise<HeteroSteerMessage | undefined> => {
  const { acceptsImageAttachments, acceptsImages, agentId, operationId, scope } = params;

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
    await holdHeteroDelivery(ctx, operationId, lapsedId, {
      ...delivery,
      drainId: drained.drainId,
    });
    return;
  }

  const canGo = (entry: QueuedFollowUp) =>
    canSteerHeteroRun(entry, agentId, acceptsImages && acceptsImageAttachments) &&
    fitsSession(entry, acceptsImages);
  const firstHeld = drained.entries.findIndex((entry) => !canGo(entry));
  const ready = firstHeld === -1 ? drained.entries : drained.entries.slice(0, firstHeld);
  const candidates = takeSameSenderFollowUps(ready).taken;

  // Resolve only the files this poll could deliver. The metadata lookup checks
  // file ownership without parsing documents that must wait for another turn.
  const candidateFileIds = [...new Set(candidates.flatMap((entry) => entry.request.fileIds ?? []))];
  const attachments = new Map<string, InlineImage>();
  if (candidateFileIds.length > 0) {
    try {
      const files = await resolveAttachmentMetadata({
        ...ctx,
        fileIds: candidateFileIds,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      for (const { fileType, id, url } of files) {
        if (url && isModelImageFileType(fileType)) attachments.set(id, { id, url });
      }
    } catch (error) {
      await returnFollowUps(scope, drained, drained.entries, error);
      return;
    }
  }
  const firstUnsupported = candidates.findIndex((entry) =>
    entry.request.fileIds?.some((id) => !attachments.has(id)),
  );
  const joining = firstUnsupported === -1 ? candidates : candidates.slice(0, firstUnsupported);
  if (joining.length === 0) {
    await returnFollowUps(scope, drained, drained.entries, 'needs a turn of its own');
    return;
  }

  const request = joining.length === 1 ? joining[0].request : mergeQueuedFollowUps(joining);
  const fileIds = [...new Set(request.fileIds)];
  const imageList = fileIds.map((id) => attachments.get(id)!);
  if (collectMarkdownImageUrls(request.prompt).length > 0) {
    try {
      const inline = fileIds.length
        ? await resolveInlineImages(ctx, request.prompt, fileIds)
        : await resolveInlineImages(ctx, request.prompt);
      imageList.push(...inline);
    } catch (error) {
      await returnFollowUps(scope, drained, drained.entries, error);
      return;
    }
  }
  const rest = drained.entries.filter((entry) => !joining.includes(entry));
  await returnFollowUps(scope, drained, rest, 'waits for the next join');

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
      await holdHeteroDelivery(ctx, operationId, messageId, {
        ...earlier,
        drainId: drained.drainId,
      });
      return;
    }

    const messageModel = new MessageModel(ctx.db, ctx.userId, ctx.workspaceId ?? undefined);
    if (await messageModel.findById(messageId)) {
      await ackFollowUps(scope, drained);
      return;
    }

    const holding = await holdHeteroDelivery(ctx, operationId, messageId, {
      agentSender: joining[0].agentSender,
      content: request.prompt,
      drainId: drained.drainId,
      editorData: request.userMessage?.editorData,
      entryId: joining[0].id,
      ...(joining.length > 1 && { entryIds: joining.map((entry) => entry.id) }),
      ...(fileIds.length > 0 && { fileIds }),
      groupId: request.appContext?.groupId ?? undefined,
      scope,
      trigger: request.trigger,
    });
    if (!holding) return;
  } catch (error) {
    await returnFollowUps(scope, drained, joining, error);
    return;
  }

  log('[%s] Delivering %d follow-ups as %s', operationId, joining.length, messageId);
  return {
    content: request.prompt,
    ...(imageList.length > 0 && { imageList }),
    messageId,
    ...(fileIds.length > 0 && { requiresImages: true }),
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

const readSteerImages = async (messageModel: MessageModel, messageId: string) => {
  const [message] = await messageModel.queryByIds([messageId], {
    postProcessUrl: async (path, file) => (file.id ? getFileProxyUrl(file.id) : (path ?? '')),
  });
  return message?.imageList?.length ? message.imageList : undefined;
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
  | {
      content: string;
      id: string;
      imageList?: ChatImageItem[];
      metadata: Record<string, unknown>;
      parentId: string | null;
    }
  | undefined
> => {
  const { messageId, operationId } = params;
  const held = await redisService.steerQueue.listHeteroDeliveries<HeteroSteerDelivery>(operationId);
  const delivery = held[messageId];

  if (!delivery) {
    const written = await messageModel.findById(messageId);
    if (written?.role !== 'user' || written.topicId !== params.topicId) return;
    const metadata = (written.metadata ?? {}) as Record<string, unknown>;
    const imageList = metadata.steer ? await readSteerImages(messageModel, messageId) : undefined;
    return {
      content: written.content ?? '',
      id: written.id,
      ...(imageList && { imageList }),
      metadata,
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
        files: delivery.fileIds,
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

  const imageList = delivery.fileIds?.length
    ? await readSteerImages(messageModel, messageId)
    : undefined;

  await ackFollowUps(delivery.scope, delivery);
  await redisService.steerQueue.removeHeteroDelivery(operationId, messageId);

  return {
    content: delivery.content,
    id: messageId,
    ...(imageList && { imageList }),
    metadata,
    parentId: params.parentId,
  };
};
