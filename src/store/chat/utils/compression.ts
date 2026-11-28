import { contextReplayMessageIds } from '@lobechat/context-engine';
import {
  type CompressionGroupMetadata,
  type ConversationContext,
  type UIChatMessage,
} from '@lobechat/types';

import { type Operation } from '../slices/operation/types';

export const isCompressionOperationType = (type?: string) =>
  type === 'contextCompression' || type === 'generateSummary';

/**
 * @param options.beforeMessageId Keep this message and everything after it out of the
 * summary, e.g. the user turn a recovery card regenerates after compacting. Compressing it
 * would hide it from the conversation, leaving nothing to regenerate.
 * @param options.threadId Compacting a thread: leave out the main-conversation messages it
 * branched from (read back with `threadId: null`); those belong to the main conversation.
 */
export const getCompressionCandidateMessages = (
  messages: UIChatMessage[],
  options?: { beforeMessageId?: string; threadId?: string | null },
) => {
  const keepFrom = options?.beforeMessageId
    ? messages.findIndex((message) =>
        contextReplayMessageIds([message]).includes(options.beforeMessageId!),
      )
    : -1;

  if (options?.beforeMessageId && keepFrom === -1) return [];
  return (keepFrom === -1 ? messages : messages.slice(0, keepFrom)).filter(
    (message) =>
      !options?.threadId || message.threadId === undefined || message.threadId === options.threadId,
  );
};

export const getCompressionCandidateMessageIds = (
  messages: UIChatMessage[],
  options?: { beforeMessageId?: string; threadId?: string | null },
) =>
  contextReplayMessageIds(
    getCompressionCandidateMessages(messages, options).filter(
      (message) => message.role !== 'compressedGroup',
    ),
  );

export const createPendingCompressedGroup = ({
  agentId,
  content = '...',
  groupId,
  id,
  keepPosition,
  threadId,
  topicId,
}: {
  agentId: string;
  content?: string;
  groupId?: string | null;
  id: string;
  /** See {@link CompressionGroupMetadata.keepPosition}. */
  keepPosition?: boolean;
  threadId?: string | null;
  topicId?: string | null;
}): UIChatMessage => {
  const now = Date.now();
  const metadata: CompressionGroupMetadata = keepPosition
    ? { expanded: true, keepPosition }
    : { expanded: true };

  return {
    agentId,
    compressedMessages: [],
    content,
    createdAt: now,
    groupId: groupId ?? undefined,
    id,
    metadata: metadata as UIChatMessage['metadata'],
    role: 'compressedGroup',
    threadId: threadId ?? undefined,
    topicId: topicId ?? undefined,
    updatedAt: now,
  };
};

/** A recompression can have no new members, so the server list has no placeholder yet. */
export const withPendingCompressedGroup = (
  messages: UIChatMessage[],
  pending: Parameters<typeof createPendingCompressedGroup>[0],
) =>
  messages.some((message) => message.id === pending.id)
    ? messages
    : [...messages, createPendingCompressedGroup(pending)];

export const hasRunningCompressionOperation = (
  operations: Operation[],
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'threadId' | 'topicId'>,
) =>
  operations.some((operation) => {
    if (operation.status !== 'running' || !isCompressionOperationType(operation.type)) return false;

    return (
      operation.context.agentId === context.agentId &&
      (operation.context.groupId ?? null) === (context.groupId ?? null) &&
      (operation.context.threadId ?? null) === (context.threadId ?? null) &&
      (operation.context.topicId ?? null) === (context.topicId ?? null)
    );
  });
