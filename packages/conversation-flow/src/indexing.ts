import type { HelperMaps, Message, MessageGroupMetadata } from './types';

/**
 * Phase 1: Indexing
 * Builds helper maps for efficient querying during parsing
 *
 * @param messages - Flat array of messages from backend
 * @param messageGroups - Optional array of message group metadata
 * @returns Helper maps for efficient access
 */
export function buildHelperMaps(
  messages: Message[],
  messageGroups?: MessageGroupMetadata[],
): HelperMaps {
  const messageMap = new Map<string, Message>();
  const childrenMap = new Map<string | null, string[]>();
  const threadMap = new Map<string, Message[]>();
  const messageGroupMap = new Map<string, MessageGroupMetadata>();

  // Build a map of lastMessageId -> compressedGroup.id for parent redirection
  // This handles the case where messages are created after compression:
  // - The new message's parentId points to the last compressed message (lastMessageId)
  // - But the lastMessageId is hidden inside the compressedGroup
  // - We need to redirect children of lastMessageId to be children of compressedGroup
  const lastMessageIdToGroupId = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'compressedGroup' && (message as any).lastMessageId) {
      lastMessageIdToGroupId.set((message as any).lastMessageId, message.id);
    }
  }

  // Single pass through messages to build all maps
  for (const message of messages) {
    // 1. Build messageMap for O(1) access
    messageMap.set(message.id, message);

    // 2. Build childrenMap for parent -> children lookup
    let parentId = message.parentId ?? null;

    // Redirect parentId if it points to a compressed message's lastMessageId
    // This ensures messages created after compression become children of the compressedGroup
    if (parentId && lastMessageIdToGroupId.has(parentId)) {
      parentId = lastMessageIdToGroupId.get(parentId)!;
    }

    const siblings = childrenMap.get(parentId);
    if (siblings) {
      siblings.push(message.id);
    } else {
      childrenMap.set(parentId, [message.id]);
    }

    // 3. Build threadMap for thread aggregation
    if (message.threadId) {
      const threadMessages = threadMap.get(message.threadId);
      if (threadMessages) {
        threadMessages.push(message);
      } else {
        threadMap.set(message.threadId, [message]);
      }
    }
  }

  // 4. Build messageGroupMap from provided metadata
  if (messageGroups) {
    for (const group of messageGroups) {
      messageGroupMap.set(group.id, group);
    }
  }

  return {
    childrenMap,
    messageGroupMap,
    messageMap,
    threadMap,
  };
}
