import type { ChannelReplyError, ChannelReplyErrorAction } from '@lobechat/types';
import { channelMessageReplyError } from '@lobechat/types';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type {
  AgentOperationError,
  AgentOperationInterruption,
  ChannelItem,
  ChannelJobItem,
  ChannelMessageItem,
} from '../../schemas';
import {
  agentOperations,
  agents,
  agentShares,
  channelJobs,
  channelMembers,
  channelMessages,
  channelThreads,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { appendMessage, takeSequence } from './delivery';
import { openingRequestKey } from './opening';
import { unhideForActivity } from './sections';
import { audit } from './transaction';

/** Request key of a job's published reply, and of its card until one is published. */
export const replyRequestKey = (jobId: string) => `job:${jobId}`;

/**
 * A message that is not a failed reply's card. Same COALESCE shape as `messageStands`, so the
 * predicate never null-tests an extracted jsonb value.
 */
export const notReplyError = () =>
  sql`COALESCE(${channelMessages.metadata} ->> 'replyError', '') = ''`;

/** What a failed reply's card is written from, read once the job settled as failed. */
export interface ChannelReplyErrorFacts {
  agent: { id: string; name: string | null };
  /** The device the reply ran on or failed to reach, as the detail view reports it. */
  deviceId: string | null;
  job: Pick<
    ChannelJobItem,
    'acceptedAt' | 'id' | 'messageId' | 'operationId' | 'status' | 'threadId' | 'topicId'
  >;
  operation: {
    error: AgentOperationError | null;
    interruption: AgentOperationInterruption | null;
    startedAt: Date | null;
    status: string;
    topicId: string | null;
    userId: string;
    workspaceId: string | null;
  } | null;
  /** The card already in the slot, from an earlier failure of the same job. */
  previous?: ChannelReplyError;
  /** The request's text, to pick the language of the card when the requester set none. */
  request: string;
  requesterUserId: string | null;
  /** Set for a shared Agent's run: its failure text is redacted for the visitor. */
  share?: { showErrorDetails: boolean };
}

type SlotJob = Pick<ChannelJobItem, 'channelId' | 'id' | 'threadId'>;

/**
 * The message in a job's reply slot: the card (or published reply) under its own request key,
 * else the job's opening acknowledgement in the same branch. `adoptOpening` also takes an
 * opening that is not a card yet, which only a new failure does; it must still stand.
 */
const findReplySlot = async (
  db: LobeChatDatabase | Transaction,
  job: SlotJob,
  adoptOpening: boolean,
): Promise<ChannelMessageItem | undefined> => {
  const rows = await db
    .select()
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.channelId, job.channelId),
        inArray(channelMessages.requestKey, [replyRequestKey(job.id), openingRequestKey(job.id)]),
      ),
    );
  const own = rows.find((row) => row.requestKey === replyRequestKey(job.id));
  if (own) return own;
  const opening = rows.find((row) => row.requestKey === openingRequestKey(job.id));
  // An acknowledgement that linked or opened a Thread sits outside the branch the reply goes to.
  if (!opening || opening.threadId !== job.threadId) return;
  if (channelMessageReplyError(opening.metadata)?.jobId === job.id) return opening;
  if (adoptOpening && !opening.metadata?.deletedAt) return opening;
};

/**
 * Moves a slot message to the end of its timeline, as a new message would be, so the person sees
 * it there and counts it unread. A Thread's root stays: the Thread hangs off its sequence.
 */
const moveToEnd = async (tx: Transaction, message: ChannelMessageItem) => {
  const [root] = await tx
    .select({ id: channelThreads.id })
    .from(channelThreads)
    .where(eq(channelThreads.rootMessageId, message.id))
    .limit(1);
  if (root) return {};
  return { createdAt: new Date(), sequence: await takeSequence(tx, message.channelId) };
};

/** Metadata without the card or a tombstone mark: what a slot keeps when it is rewritten. */
const baseMetadata = (metadata: ChannelMessageItem['metadata']) => {
  const { deletedAt: _deletedAt, replyError: _replyError, ...rest } = metadata ?? {};
  return rest;
};

/**
 * The facts a failed job's card is written from; undefined unless the job failed without
 * publishing anything. Reads without the channel lock: the card is written under it later.
 */
export const readReplyErrorFacts = async (
  db: LobeChatDatabase,
  channelId: string,
  jobId: string,
): Promise<ChannelReplyErrorFacts | undefined> => {
  const [row] = await db
    .select({
      agentName: agents.name,
      deviceId: sql<string | null>`COALESCE(
          ${channelJobs.deviceId},
          ${agentOperations.error}->'deviceRoute'->>'deviceId',
          ${channelJobs.executionConfig}->'agencyConfig'->>'boundDeviceId'
        )`,
      job: channelJobs,
      operation: agentOperations,
      request: channelMessages.content,
      requesterUserId: channelMembers.userId,
      shareShowsErrorDetails: sql<boolean>`COALESCE(${agentShares.shareConfig}->>'showErrorDetails' = 'true', false)`,
    })
    .from(channelJobs)
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .leftJoin(channelMembers, eq(channelMembers.id, channelJobs.requesterMemberId))
    .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
    .leftJoin(agents, sql`${agents.id} = ${channelJobs.manifest}->'self'->>'agentId'`)
    .leftJoin(
      agentShares,
      sql`${agentShares.id}::text = ${channelJobs.executionConfig}->'share'->>'shareId'`,
    )
    .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, jobId)))
    .limit(1);
  const job = row?.job;
  if (!job?.manifest || job.status !== 'failed' || job.publishedMessageId) return;

  const slot = await findReplySlot(db, job, false);
  const previous = channelMessageReplyError(slot?.metadata);
  const { operation } = row;
  return {
    agent: { id: job.manifest.self.agentId, name: row.agentName ?? job.manifest.self.name },
    deviceId: row.deviceId,
    job: {
      acceptedAt: job.acceptedAt,
      id: job.id,
      messageId: job.messageId,
      operationId: job.operationId,
      status: job.status,
      threadId: job.threadId,
      topicId: job.topicId,
    },
    operation: operation && {
      error: operation.error ?? null,
      interruption: operation.interruption ?? null,
      startedAt: operation.startedAt,
      status: operation.status,
      topicId: operation.topicId,
      userId: operation.userId,
      workspaceId: operation.workspaceId,
    },
    ...(previous?.jobId === job.id && { previous }),
    request: row.request,
    requesterUserId: row.requesterUserId,
    ...(job.executionConfig?.share && {
      share: { showErrorDetails: row.shareShowsErrorDetails },
    }),
  };
};

/** A failed reply's card before the slot numbers it; see {@link upsertReplyError}. */
export type ChannelReplyErrorDraft = Omit<ChannelReplyError, 'attempts' | 'jobId' | 'operationId'>;

/**
 * Writes a failed job's card into its reply slot, under the channel lock: the job's opening
 * acknowledgement turned into the card when it posted one in the reply's branch, else a new
 * message from the replying Agent under the reply's own request key. A later failure of the same
 * job rewrites that one message and counts the attempt; the same run reported twice changes
 * nothing. The card moves to the end of the timeline like a new message, so the requester is
 * notified as for a reply. It never carries mentions and never routes.
 *
 * Returns undefined when the job no longer qualifies (published, not failed, archived branch).
 */
export const upsertReplyError = async (
  tx: Transaction,
  channel: ChannelItem,
  jobId: string,
  draft: ChannelReplyErrorDraft,
): Promise<{ card: ChannelReplyError; changed: boolean; messageId: string } | undefined> => {
  if (channel.isDeleted || channel.status !== 'active') return;
  const [job] = await tx
    .select()
    .from(channelJobs)
    .where(and(eq(channelJobs.channelId, channel.id), eq(channelJobs.id, jobId)));
  if (!job?.manifest || job.status !== 'failed' || job.publishedMessageId) return;
  if (job.threadId) {
    const [thread] = await tx
      .select({ status: channelThreads.status })
      .from(channelThreads)
      .where(eq(channelThreads.id, job.threadId));
    if (thread?.status === 'archived') return;
  }

  const slot = await findReplySlot(tx, job, true);
  const previous = channelMessageReplyError(slot?.metadata);
  const earlier = previous?.jobId === job.id ? previous : undefined;
  if (slot && earlier && (earlier.operationId ?? null) === job.operationId)
    return { card: earlier, changed: false, messageId: slot.id };

  const card: ChannelReplyError = {
    ...draft,
    attempts: (earlier?.attempts ?? 0) + 1,
    jobId: job.id,
    operationId: job.operationId,
  };
  let messageId: string;
  if (slot) {
    await tx
      .update(channelMessages)
      .set({
        content: card.summary,
        kind: 'error',
        mentions: [],
        metadata: { ...baseMetadata(slot.metadata), replyError: card },
        ...(await moveToEnd(tx, slot)),
      })
      .where(eq(channelMessages.id, slot.id));
    await unhideForActivity(tx, channel.id);
    messageId = slot.id;
  } else {
    const posted = await appendMessage(tx, {
      agentId: job.manifest.self.agentId,
      channelId: channel.id,
      content: card.summary,
      kind: 'error',
      metadata: { replyError: card },
      replyToId: job.messageId,
      requestKey: replyRequestKey(job.id),
      routingStatus: 'reply',
      threadId: job.threadId,
    });
    messageId = posted.id;
  }
  await audit(tx, channel.id, 'reply_error_posted', job.id, {
    attempts: card.attempts,
    messageId,
    operationId: job.operationId,
  });

  return { card, changed: true, messageId };
};

/**
 * Rewrites the explanation of a card in place once a model has written a better one. Only the
 * card of `operationId` changes: a later failure, or the reply that replaced it, wins.
 */
export const refineReplyError = async (
  tx: Transaction,
  channelId: string,
  jobId: string,
  operationId: string | null,
  refined: { actions: ChannelReplyErrorAction[]; summary: string },
): Promise<boolean> => {
  const [job] = await tx
    .select({
      channelId: channelJobs.channelId,
      id: channelJobs.id,
      threadId: channelJobs.threadId,
    })
    .from(channelJobs)
    .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, jobId)));
  if (!job) return false;
  const slot = await findReplySlot(tx, job, false);
  const card = channelMessageReplyError(slot?.metadata);
  if (!slot || card?.jobId !== jobId || (card.operationId ?? null) !== operationId) return false;

  await tx
    .update(channelMessages)
    .set({
      content: refined.summary,
      metadata: { ...slot.metadata, replyError: { ...card, ...refined } },
    })
    .where(eq(channelMessages.id, slot.id));
  return true;
};

/**
 * Publishes a reply over the card in its slot, if there is one: the same message takes the reply's
 * text, loses `replyError` and moves to the end like a new reply. A card that had adopted the
 * job's acknowledgement also takes the reply's own request key, so the published answer is news
 * again instead of still reading as an acknowledgement. Undefined when the slot holds no card, so
 * the caller appends the reply instead.
 */
export const replaceReplyError = async (
  tx: Transaction,
  job: SlotJob,
  published: Pick<ChannelMessageItem, 'content'> &
    Partial<Pick<ChannelMessageItem, 'kind' | 'metadata'>>,
): Promise<ChannelMessageItem | undefined> => {
  const slot = await findReplySlot(tx, job, false);
  if (!slot) return;

  const [reply] = await tx
    .update(channelMessages)
    .set({
      content: published.content,
      kind: published.kind ?? 'text',
      mentions: [],
      metadata: { ...baseMetadata(slot.metadata), ...published.metadata },
      // Cleared as an acknowledgement: `lastNewsAt` counts the published reply, not the opening.
      ...(slot.requestKey === openingRequestKey(job.id) && {
        requestKey: replyRequestKey(job.id),
      }),
      ...(await moveToEnd(tx, slot)),
    })
    .where(eq(channelMessages.id, slot.id))
    .returning();
  await unhideForActivity(tx, job.channelId);
  return reply;
};

/** The card in a job's reply slot, if it shows one. */
export const findReplyError = async (
  db: LobeChatDatabase,
  job: SlotJob,
): Promise<ChannelReplyError | undefined> => {
  const card = channelMessageReplyError((await findReplySlot(db, job, false))?.metadata);
  return card?.jobId === job.id ? card : undefined;
};
