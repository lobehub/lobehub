import {
  type CompressionGroupMetadata,
  type ConversationContext,
  type UIChatMessage,
} from '@lobechat/types';

import { type Operation } from '../slices/operation/types';

export const isCompressionOperationType = (type?: string) =>
  type === 'contextCompression' || type === 'generateSummary';

export const getCompressionCandidateMessageIds = (messages: UIChatMessage[]) => {
  // Collect ids of messages that are already inside a compression group
  // (surfaced via the compressedGroup node's compressedMessages array) so we
  // don't re-submit them — server MessageModel.query filters out messages with
  // a non-null messageGroupId, which would otherwise yield an empty summary payload.
  const alreadyCompressed = new Set<string>();
  for (const message of messages) {
    if (message.role === 'compressedGroup' && message.compressedMessages) {
      for (const inner of message.compressedMessages) {
        if (inner.id) alreadyCompressed.add(inner.id);
      }
    }
  }
  return messages
    .filter((message) => message.role !== 'compressedGroup' && !alreadyCompressed.has(message.id))
    .map((message) => message.id)
    .filter(Boolean);
};

export const createPendingCompressedGroup = ({
  agentId,
  content = '...',
  groupId,
  id,
  threadId,
  topicId,
}: {
  agentId: string;
  content?: string;
  groupId?: string | null;
  id: string;
  threadId?: string | null;
  topicId?: string | null;
}): UIChatMessage => {
  const now = Date.now();
  const metadata: CompressionGroupMetadata = { expanded: true };

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
