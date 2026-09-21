import { Message } from 'chat';

import type { DeferredBotMessage } from './deferredMessages';

/**
 * Field stamped on a merged message so downstream consumers (notably
 * `AgentBridgeService.resolveFiles`) can reach every original message's
 * `raw`, not just the last one's. Per-platform `extractFiles` re-downloads
 * media from `raw`, so without this an image that arrived one message before
 * the text is lost when the two are merged into a single turn.
 *
 * The field is in-process only: the Chat SDK's `Message.toJSON` drops it.
 * Replay must enqueue original messages separately and merge only after the
 * SDK has restored them from its queue.
 */
export const SOURCE_MESSAGES_FIELD = 'sourceMessages';

type MessageWithSources = Message & { [SOURCE_MESSAGES_FIELD]?: Message[] };

/** Earlier messages may contribute content and triggers only for the same sender. */
export function getSameSenderMessages(message: Message, earlier?: Message[]): Message[] {
  const senderId = message.author?.userId;
  if (!senderId) return [];

  return (earlier ?? []).filter(
    (source) =>
      source.author?.userId === senderId &&
      source.author?.isBot === message.author.isBot &&
      source.author?.isMe === message.author.isMe,
  );
}

/**
 * Merge earlier messages (chronological) into `message`, producing a single
 * message with combined text + attachments and the full source list. Returns
 * `message` untouched when there is nothing to merge.
 */
export function mergeBotMessages(message: Message, earlier: Message[] | undefined): Message {
  const sameSender = getSameSenderMessages(message, earlier);
  if (sameSender.length === 0) return message;

  const allMessages = [...sameSender, message].flatMap(getSourceMessages);
  const mergedText = allMessages
    .map((m) => m.text)
    .filter(Boolean)
    .join('\n');
  const mergedAttachments = allMessages.flatMap((m) => (m as any).attachments || []);

  return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
    attachments: mergedAttachments,
    [SOURCE_MESSAGES_FIELD]: allMessages,
    text: mergedText,
  });
}

/**
 * Every original message behind `message`: the merged sources when it was
 * produced by {@link mergeBotMessages}, otherwise the message itself.
 */
export function getSourceMessages(message: Message): Message[] {
  const sources = (message as MessageWithSources)[SOURCE_MESSAGES_FIELD];
  return sources?.length ? sources : [message];
}

/**
 * Rebuild original messages from deferred payloads (oldest first).
 *
 * The replayed message gets a fresh id: the Chat SDK dedupes inbound messages
 * by `<adapter>:<id>` for 10 minutes, and the originals already went through
 * `processMessage` once when they were deferred.
 */
export function buildReplayMessages(entries: DeferredBotMessage[]): Message[] {
  const now = Date.now();
  return entries.map((entry, index) => {
    return Message.fromJSON({ ...entry, id: `${entry.id}:replay:${now}:${index}` });
  });
}
