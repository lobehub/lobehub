import {
  type CompressionGroupMetadata,
  type ConversationContext,
  type UIChatMessage,
} from '@lobechat/types';

import { type Operation } from '../slices/operation/types';

export const isCompressionOperationType = (type?: string) =>
  type === 'contextCompression' || type === 'generateSummary';

export const getCompressionCandidateMessageIds = (messages: UIChatMessage[]) =>
  messages
    .filter((message) => message.role !== 'compressedGroup')
    .map((message) => message.id)
    .filter(Boolean);

const collectCompressedGroupMessageIds = (messages: UIChatMessage[]): Set<string> => {
  const ids = new Set<string>();

  const walk = (message: UIChatMessage | undefined) => {
    if (!message) return;
    if (message.id) ids.add(message.id);
    if ('lastMessageId' in message && typeof message.lastMessageId === 'string') {
      ids.add(message.lastMessageId);
    }
    message.compressedMessages?.forEach(walk);
    message.children?.forEach(walk);
    for (const pinned of message.pinnedMessages ?? []) {
      if (pinned.id) ids.add(pinned.id);
    }
    for (const tool of message.tools ?? []) {
      if (tool.result_msg_id) ids.add(tool.result_msg_id);
    }
  };

  for (const message of messages) {
    if (message.role === 'compressedGroup') walk(message);
  }

  return ids;
};

/**
 * Mid-turn compression snapshots nest the already-streamed assistant/tool
 * turn inside `compressedGroup` and leave only the latest user on the mainline.
 * Re-attach local messages that follow that user only when they are proven to
 * live inside an incoming compressed group — never resurrect a server-deleted row.
 */
export const graftInFlightTurnAfterLatestUser = (
  snapshot: UIChatMessage[],
  localMessages: UIChatMessage[],
): UIChatMessage[] => {
  const latestUser = snapshot.findLast((message) => message.role === 'user');
  if (!latestUser?.id) return snapshot;

  const foldedIds = collectCompressedGroupMessageIds(snapshot);
  if (foldedIds.size === 0) return snapshot;

  const snapshotIds = new Set(snapshot.map((message) => message.id));
  const localUserIndex = localMessages.findIndex((message) => message.id === latestUser.id);
  const inFlight =
    localUserIndex >= 0
      ? localMessages.slice(localUserIndex + 1)
      : localMessages.filter(
          (message) =>
            message.createdAt > latestUser.createdAt ||
            (message.createdAt === latestUser.createdAt && message.id > latestUser.id),
        );

  const missing = inFlight.filter(
    (message) =>
      Boolean(message.id) &&
      !snapshotIds.has(message.id) &&
      foldedIds.has(message.id) &&
      message.role !== 'compressedGroup',
  );
  if (missing.length === 0) return snapshot;

  return [...snapshot, ...missing];
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
