import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';

import type { ChannelViewParams } from '@/services/channel';

/** `sent` waits until a loaded page of its conversation holds the stored message. */
export type ChannelOutgoingStatus = 'failed' | 'sending' | 'sent';

/** A message this tab sent before the conversation it belongs to holds it. Never persisted. */
export interface ChannelOutgoingMessage {
  /** Uploaded files, kept so the message shows them before the conversation lists them. */
  attachments: ChannelDetail['attachments'];
  channelId: string;
  content: string;
  createdAt: Date;
  fileIds: string[];
  mentions: string[];
  replyTo?: ChannelPublicMessage['replyTo'];
  replyToId?: string;
  /** Also its client id: a retry reuses it, so the server stores the message once. */
  requestKey: string;
  scope: string;
  /** Where the server stored it; a reply to an Agent can move into a thread. */
  sent?: Pick<ChannelPublicMessage, 'id' | 'sequence' | 'threadId'>;
  status: ChannelOutgoingStatus;
  threadId: string | null;
}

export type ChannelOutbox = Record<string, ChannelOutgoingMessage[]>;

export const channelOutboxKey = (channelId: string, threadId?: string | null) =>
  `${channelId}:${threadId ?? 'main'}`;

const outboxKeyOf = (message: Pick<ChannelOutgoingMessage, 'channelId' | 'threadId'>) =>
  channelOutboxKey(message.channelId, message.threadId);

const withEntries = (outbox: ChannelOutbox, key: string, entries: ChannelOutgoingMessage[]) => {
  const { [key]: _, ...rest } = outbox;
  return entries.length ? { ...rest, [key]: entries } : rest;
};

export const findOutgoing = (outbox: ChannelOutbox, message: ChannelOutgoingMessage) =>
  outbox[outboxKeyOf(message)]?.find((entry) => entry.requestKey === message.requestKey);

export const addOutgoing = (outbox: ChannelOutbox, message: ChannelOutgoingMessage) => {
  const key = outboxKeyOf(message);
  return withEntries(outbox, key, [...(outbox[key] ?? []), message]);
};

export const patchOutgoing = (
  outbox: ChannelOutbox,
  message: ChannelOutgoingMessage,
  patch: Partial<Pick<ChannelOutgoingMessage, 'sent' | 'status'>>,
) => {
  const key = outboxKeyOf(message);
  const entries = outbox[key];
  if (!entries?.some((entry) => entry.requestKey === message.requestKey)) return outbox;
  return withEntries(
    outbox,
    key,
    entries.map((entry) =>
      entry.requestKey === message.requestKey ? { ...entry, ...patch } : entry,
    ),
  );
};

export const removeOutgoing = (outbox: ChannelOutbox, message: ChannelOutgoingMessage) => {
  const key = outboxKeyOf(message);
  const entries = outbox[key];
  if (!entries) return outbox;
  return withEntries(
    outbox,
    key,
    entries.filter((entry) => entry.requestKey !== message.requestKey),
  );
};

/**
 * Drops the sent messages that a newly loaded latest page accounts for: the page holds the
 * stored message or a later one, or the server moved it into another conversation. A page
 * read before the write landed holds neither, so the message stays until a later read.
 * Only confirmed sends settle: a send stored on the server whose response was lost stays
 * failed beside the stored copy, and its retry returns that copy under the same request key.
 */
export const settleOutbox = (
  outbox: ChannelOutbox,
  params: ChannelViewParams,
  data: ChannelDetail,
  scope: string,
) => {
  if (params.before !== undefined) return outbox;
  const key = channelOutboxKey(params.channelId, params.threadId);
  const entries = outbox[key];
  if (!entries) return outbox;
  const threadId = params.threadId ?? null;
  const remaining = entries.filter(
    ({ scope: entryScope, sent }) =>
      !sent ||
      entryScope !== scope ||
      (sent.threadId === threadId &&
        !data.messages.some((item) => item.id === sent.id || item.sequence > sent.sequence)),
  );
  return remaining.length === entries.length ? outbox : withEntries(outbox, key, remaining);
};
