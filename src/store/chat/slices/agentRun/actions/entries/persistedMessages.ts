import type { MessageMetadata, UIChatMessage } from '@lobechat/types';

/**
 * Re-attach the metadata the client resolved at send time to the persisted user
 * row, so fields the server response does not echo keep rendering.
 */
export const attachSendTimeMetadataToUserMessage = (
  messages: UIChatMessage[],
  userMessageId: string,
  metadata: MessageMetadata | undefined,
): UIChatMessage[] => {
  if (!metadata) return messages;

  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.id !== userMessageId) return message;

    changed = true;
    return {
      ...message,
      metadata: {
        ...(message.metadata ?? undefined),
        ...metadata,
      },
    };
  });

  return changed ? nextMessages : messages;
};

/**
 * Merge a partial server response into the current list: the optimistic rows it
 * replaces and any row it re-sends are dropped in favour of the persisted ones.
 */
export const mergePartialPersistedMessages = (
  currentMessages: UIChatMessage[],
  persistedMessages: UIChatMessage[],
  replacedMessageIds: string[],
): UIChatMessage[] => {
  const replacedIdSet = new Set(replacedMessageIds);
  const persistedIdSet = new Set(persistedMessages.map((message) => message.id));

  return [
    ...currentMessages.filter(
      (message) => !replacedIdSet.has(message.id) && !persistedIdSet.has(message.id),
    ),
    ...persistedMessages,
  ];
};

export const resolveSendResponseMessages = ({
  currentMessages,
  isPartial,
  messages,
  replacedMessageIds,
  userMessageId,
  userMessageMetadata,
}: {
  currentMessages: UIChatMessage[];
  isPartial: boolean;
  messages: UIChatMessage[];
  replacedMessageIds: string[];
  userMessageId: string;
  userMessageMetadata: MessageMetadata | undefined;
}): UIChatMessage[] => {
  const persisted = attachSendTimeMetadataToUserMessage(
    messages,
    userMessageId,
    userMessageMetadata,
  );
  return isPartial
    ? mergePartialPersistedMessages(currentMessages, persisted, replacedMessageIds)
    : persisted;
};
