import type { ChannelMessageMetadata, ChannelRoutingMode } from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { ChannelMessageItem } from '../../schemas';
import { agents, channelMembers, channelMessages, channelThreads, files } from '../../schemas';
import type { Transaction } from '../../type';
import { isUuid } from '../../utils/uuid';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { attachFiles, fileIdsByMessage } from './attachments';
import {
  activeMembers,
  appendMessage,
  assertThreadOpen,
  candidateAgents,
  deliver,
  findThread,
  pairedAgent,
} from './delivery';
import { ChannelError } from './error';
import { isWorkspaceMember, peerOf, requirePeerRelation } from './peer';
import { audit } from './transaction';
import type { ChannelAccess } from './types';
import { createChannelThread } from './view';

export interface ChannelSendInput {
  /**
   * Server only: the Agent member that writes this request in a conversation between Agents
   * (`channels.agentPairKey`). The caller stays the requester and execution identity.
   */
  authorAgentMemberId?: string;
  content: string;
  fileIds?: string[];
  /** Member ids. A human quote dispatches only its mentioned Agents. */
  mentions?: string[];
  /** Stored with the message, e.g. `via` for a request an Agent relayed for the caller. */
  metadata?: ChannelMessageMetadata;
  /** Quote a message in its own feed; @mentions dispatch, else a quoted Agent answers. */
  replyToId?: string;
  /** Client retry key; a retry with the same key returns the original message. */
  requestKey: string;
  /** Create/reuse a branch and send its first message in the same transaction. */
  rootMessageId?: string;
  /** How to route a message without @mentioned Agents. */
  routing: ChannelRoutingMode;
  threadId?: string | null;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export const validateSendInput = (input: ChannelSendInput) => {
  if (input.replyToId && input.rootMessageId)
    throw new ChannelError('BAD_REQUEST', 'Choose a reply or a thread root, not both');
  if (input.rootMessageId && input.threadId)
    throw new ChannelError('BAD_REQUEST', 'Choose a thread or a root message, not both');
  const fileIds = [...new Set(input.fileIds ?? [])];
  if (
    (!input.content.trim() && !fileIds.length) ||
    !input.requestKey ||
    input.content.length > CHANNEL_LIMITS.contentLength ||
    fileIds.length > CHANNEL_LIMITS.attachments
  )
    throw new ChannelError('BAD_REQUEST', 'A message requires bounded content and a retry key');

  const mentions = input.mentions ?? [];
  if (mentions.some((id) => !isUuid(id)))
    throw new ChannelError('BAD_REQUEST', 'Mentions must be valid member UUIDs');

  return { fileIds, mentions: [...new Set(mentions.map((id) => id.toLowerCase()))] };
};

/**
 * Posts a human message. The caller holds the channel lock and is `access.member`.
 *
 * - A reply stays in the feed of the message it quotes; it never opens a Thread.
 * - Quoting a person without mentions gets no jobs. Quoting an Agent without mentions asks that
 *   Agent; with @mentions, only the mentioned Agents answer.
 * - @mentioned Agents get jobs in this transaction (`directed`, source `explicit`), quoted or not.
 * - @mentioning only people wakes no Agent.
 * - Without mentions, `decision` leaves the message `pending` for the routing task, and
 *   `fallback` hands it to every candidate Agent at once.
 * - A group with one person and one Agent skips routing: any message that mentions no
 *   Agent, in the main channel or a Thread, goes straight to that Agent.
 */
export const sendMessage = async (
  tx: Transaction,
  { channel, member }: ChannelAccess,
  input: ChannelSendInput,
): Promise<ChannelMessageItem> => {
  const { fileIds, mentions } = validateSendInput(input);
  const author = await requestAuthor(tx, channel, input.authorAgentMemberId);
  if (author && (mentions.includes(author.id) || fileIds.length))
    throw new ChannelError('BAD_REQUEST', 'An Agent asks the other Agent, without attachments');
  const [replyTo] = input.replyToId
    ? await tx
        .select()
        .from(channelMessages)
        .where(
          and(eq(channelMessages.channelId, channel.id), eq(channelMessages.id, input.replyToId)),
        )
    : [];
  if (input.replyToId && !replyTo)
    throw new ChannelError('BAD_REQUEST', 'Reply message is unavailable');
  const sourceThread = assertThreadOpen(await findThread(tx, channel.id, input.threadId));
  if (
    replyTo &&
    replyTo.threadId !== (sourceThread?.id ?? null) &&
    replyTo.id !== sourceThread?.rootMessageId
  )
    throw new ChannelError('BAD_REQUEST', 'Reply message belongs to another conversation');
  const humanQuote = !!replyTo && replyTo.routingStatus !== 'reply';
  // An explicit @mention still dispatches; the quote only adds context.
  const quoteOnly = humanQuote && !mentions.length;
  // Quoting an Agent asks it only when nobody is @mentioned: a mention names who should answer.
  const [replyAgent] =
    replyTo && !humanQuote && !mentions.length
      ? await tx
          .select()
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, channel.id),
              eq(channelMembers.agentId, replyTo.agentId!),
              eq(channelMembers.actorType, 'agent'),
              eq(channelMembers.status, 'active'),
            ),
          )
      : [];
  if (replyTo && !humanQuote && !mentions.length && !replyAgent)
    throw new ChannelError('BAD_REQUEST', 'The replying Agent is no longer available');
  // Replying to a muted Agent asks no one; only an @mention makes it answer.
  const replyTarget = replyAgent?.config?.muted ? undefined : replyAgent;
  const thread = assertThreadOpen(
    input.rootMessageId
      ? await createChannelThread(tx, channel.id, { rootMessageId: input.rootMessageId })
      : sourceThread,
  );
  const threadId = thread?.id ?? null;

  const [existing] = await tx
    .select()
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.channelId, channel.id),
        eq(channelMessages.requestKey, input.requestKey),
      ),
    );
  if (existing) {
    const existingFileIds = (await fileIdsByMessage(tx, [existing.id])).get(existing.id) ?? [];
    if (
      existing.userId !== (author ? null : member.userId) ||
      existing.agentId !== (author?.agentId ?? null) ||
      existing.content !== input.content ||
      existing.replyToId !== (input.replyToId ?? null) ||
      existing.threadId !== threadId ||
      !sameList(existingFileIds, fileIds) ||
      !sameList(existing.mentions, mentions)
    )
      throw new ChannelError('CONFLICT', 'Retry key was already used for a different message');
    return existing;
  }

  // Removing a contact, or either person leaving the workspace, silences the conversation for
  // both people; its history stays.
  if (channel.peerUserId && member.userId)
    await requirePeerRelation(
      tx,
      channel.workspaceId,
      member.userId,
      peerOf(channel, member.userId)!,
    );

  if (fileIds.length && channel.agentId) {
    // Another person's shared Agent runs as its owner, who cannot read the sender's files.
    const [bound] = await tx
      .select({ ownerId: agents.userId })
      .from(agents)
      .where(eq(agents.id, channel.agentId));
    if (bound?.ownerId !== member.userId && !channel.workspaceId)
      throw new ChannelError('BAD_REQUEST', 'Attachments cannot be sent to a shared Agent');
  }

  if (fileIds.length) {
    // A workspace's public files are its members'. An external contact talking in it attaches
    // only files they uploaded themselves, never one of the workspace's by its id.
    const external =
      !!channel.workspaceId && !(await isWorkspaceMember(tx, channel.workspaceId, member.userId!));
    // Lock in a stable order so concurrent sends and file cleanup cannot deadlock.
    const accessible = await tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          inArray(files.id, fileIds),
          external
            ? eq(files.userId, member.userId!)
            : buildWorkspaceWhere(
                { userId: member.userId!, workspaceId: channel.workspaceId ?? undefined },
                files,
              ),
        ),
      )
      .orderBy(asc(files.id))
      .for('update');
    if (accessible.length !== fileIds.length)
      throw new ChannelError('BAD_REQUEST', 'One or more attachments are unavailable');
  }

  const mentioned = quoteOnly ? [] : await activeMembers(tx, channel.id, mentions);
  const mentionedAgents = mentioned.filter((target) => target.actorType === 'agent');
  const paired =
    replyTo || channel.agentId || mentionedAgents.length
      ? undefined
      : await pairedAgent(tx, channel.id);
  // The paired Agent follows the Thread it answers, like a mentioned one.
  const followers = quoteOnly
    ? []
    : [
        ...mentions,
        ...(replyTarget ? [replyTarget.id] : []),
        ...(thread && paired ? [paired.id] : []),
      ];
  if (thread && followers.some((id) => !thread.followerMemberIds.includes(id))) {
    await tx
      .update(channelThreads)
      .set({ followerMemberIds: [...new Set([...thread.followerMemberIds, ...followers])] })
      .where(eq(channelThreads.id, thread.id));
  }

  const candidates =
    replyTo || paired || mentions.length
      ? []
      : await candidateAgents(tx, channel.id, channel.agentId ? null : thread);
  const direct = !!channel.agentId && candidates.length > 0;
  const [pendingRoot] =
    thread && !replyTo && !paired && !mentions.length && !direct
      ? await tx
          .select({ id: channelMessages.id })
          .from(channelMessages)
          .where(
            and(
              eq(channelMessages.id, thread.rootMessageId),
              eq(channelMessages.routingStatus, 'pending'),
            ),
          )
      : [];
  const routed = quoteOnly
    ? ({ reason: 'Quoted human message', source: 'explicit', status: 'skipped' } as const)
    : replyAgent
      ? replyTarget
        ? ({ reason: 'Reply to Agent', source: 'explicit', status: 'directed' } as const)
        : ({ reason: 'The Agent is muted', source: 'explicit', status: 'skipped' } as const)
      : paired
        ? ({ reason: 'Only Agent in the Channel', source: 'explicit', status: 'directed' } as const)
        : mentions.length
          ? ({ reason: 'Mentioned', source: 'explicit', status: 'directed' } as const)
          : pendingRoot
            ? {
                reason: 'Waiting for the root message routing decision',
                source: input.routing === 'fallback' ? ('fallback' as const) : null,
                status: 'pending' as const,
              }
            : !candidates.length
              ? ({ reason: 'No Agent can answer here', source: null, status: 'skipped' } as const)
              : direct
                ? ({
                    reason: 'Direct conversation',
                    source: 'explicit',
                    status: 'directed',
                  } as const)
                : input.routing === 'decision'
                  ? ({ reason: null, source: null, status: 'pending' } as const)
                  : ({
                      reason: 'No decision model configured',
                      source: 'fallback',
                      status: 'assigned',
                    } as const);
  const recipients = quoteOnly
    ? []
    : replyAgent
      ? replyTarget
        ? [replyTarget]
        : []
      : paired
        ? [paired]
        : mentions.length
          ? mentionedAgents
          : direct || routed.status === 'assigned'
            ? candidates
            : [];

  const message = await appendMessage(tx, {
    ...(author ? { agentId: author.agentId } : { userId: member.userId }),
    channelId: channel.id,
    content: input.content,
    mentions,
    ...(input.metadata && { metadata: input.metadata }),
    requestKey: input.requestKey,
    replyToId: input.replyToId,
    routingAttempt: routed.status === 'pending' ? 1 : 0,
    routingReason: routed.reason,
    routingSource: routed.source,
    routingStatus: routed.status,
    threadId,
  });
  await attachFiles(tx, { fileIds, messageId: message.id });
  // Like any chat app, sending reads the conversation up to the sender's own message, so it
  // never counts as unread (or notifies) on the sender's other devices. An Agent's request, or a
  // relay (`via`) posted for the person, is not the person reading: their unseen messages stay
  // unread.
  if (!author && !input.metadata?.via)
    await tx
      .update(channelMembers)
      .set({
        lastReadSequence: sql`greatest(coalesce(${channelMembers.lastReadSequence}, 0), ${message.sequence})`,
      })
      .where(eq(channelMembers.id, member.id));
  const delivered = await deliver(tx, message, recipients, member.id);
  if (delivered.length) {
    await tx
      .update(channelMessages)
      .set({ recipientMemberIds: delivered })
      .where(eq(channelMessages.id, message.id));
    message.recipientMemberIds = delivered;
  }

  await audit(tx, channel.id, 'message_accepted', message.id, {
    mentions,
    recipients: delivered,
    routing: routed.status,
  });

  return message;
};

/**
 * The Agent member writing a request, which only a conversation between Agents accepts. Without
 * one, the caller writes it.
 */
const requestAuthor = async (
  tx: Transaction,
  channel: ChannelAccess['channel'],
  memberId: string | undefined,
) => {
  if (!memberId) return;
  if (!channel.agentPairKey)
    throw new ChannelError(
      'BAD_REQUEST',
      'Only a conversation between Agents takes Agent requests',
    );
  const [author] = await activeMembers(tx, channel.id, [memberId]);
  if (author?.actorType !== 'agent' || !author.agentId)
    throw new ChannelError('BAD_REQUEST', 'The asking Agent is not in this conversation');
  return author;
};
