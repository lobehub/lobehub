import type { ChannelRoutingMode } from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { ChannelMessageItem } from '../../schemas';
import { channelMessages, channelThreads, files } from '../../schemas';
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
} from './delivery';
import { ChannelError } from './error';
import { audit } from './transaction';
import type { ChannelAccess } from './types';
import { createChannelThread } from './view';

export interface ChannelSendInput {
  content: string;
  fileIds?: string[];
  /** Member ids. Mentioned Agents run; mentioned people are only notified. */
  mentions?: string[];
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
 * - @mentioned Agents get jobs in this transaction (`directed`, source `explicit`).
 * - @mentioning only people wakes no Agent.
 * - Without mentions, `jev` leaves the message `pending` for the routing task, and
 *   `fallback` hands it to every candidate Agent at once.
 */
export const sendMessage = async (
  tx: Transaction,
  { channel, member }: ChannelAccess,
  input: ChannelSendInput,
): Promise<ChannelMessageItem> => {
  const { fileIds, mentions } = validateSendInput(input);
  // Reopening an archived branch from its root must not post into it either.
  const thread = assertThreadOpen(
    input.rootMessageId
      ? await createChannelThread(tx, channel.id, { rootMessageId: input.rootMessageId })
      : await findThread(tx, channel.id, input.threadId || null),
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
      existing.userId !== member.userId ||
      existing.agentId !== null ||
      existing.content !== input.content ||
      existing.threadId !== threadId ||
      !sameList(existingFileIds, fileIds) ||
      !sameList(existing.mentions, mentions)
    )
      throw new ChannelError('CONFLICT', 'Retry key was already used for a different message');
    return existing;
  }

  if (fileIds.length) {
    // Lock in a stable order so concurrent sends and file cleanup cannot deadlock.
    const accessible = await tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          inArray(files.id, fileIds),
          buildWorkspaceWhere(
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

  const mentioned = await activeMembers(tx, channel.id, mentions);
  const mentionedAgents = mentioned.filter((target) => target.actorType === 'agent');
  if (thread && mentioned.length) {
    await tx
      .update(channelThreads)
      .set({ followerMemberIds: [...new Set([...thread.followerMemberIds, ...mentions])] })
      .where(eq(channelThreads.id, thread.id));
  }

  const candidates = mentions.length
    ? []
    : await candidateAgents(tx, channel.id, channel.agentId ? null : thread);
  const direct = !!channel.agentId && candidates.length > 0;
  const [pendingRoot] =
    thread && !mentions.length && !direct
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
  const routed = mentions.length
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
          ? ({ reason: 'Direct conversation', source: 'explicit', status: 'directed' } as const)
          : input.routing === 'jev'
            ? ({ reason: null, source: null, status: 'pending' } as const)
            : ({
                reason: 'No decision model configured',
                source: 'fallback',
                status: 'assigned',
              } as const);
  const recipients = mentions.length
    ? mentionedAgents
    : direct || routed.status === 'assigned'
      ? candidates
      : [];

  const message = await appendMessage(tx, {
    userId: member.userId,
    channelId: channel.id,
    content: input.content,
    mentions,
    requestKey: input.requestKey,
    routingAttempt: routed.status === 'pending' ? 1 : 0,
    routingReason: routed.reason,
    routingSource: routed.source,
    routingStatus: routed.status,
    threadId,
  });
  await attachFiles(tx, { fileIds, messageId: message.id });
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
