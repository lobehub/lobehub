import type { UIChatMessage } from '@lobechat/types';

// Marks messages that should be rendered locally but never forwarded into the
// real send pipeline or persisted to the database.
export const LOCAL_MESSAGE_SCOPE = '__internal_local__';

export const isLocalOnlyMessage = (message: UIChatMessage | undefined) =>
  message?.metadata?.scope === LOCAL_MESSAGE_SCOPE;

/**
 * Insert transient rows into a server snapshot without moving them to the end of the transcript.
 * Only local rows are repositioned; the canonical order of persisted messages remains untouched.
 */
export const mergeLocalMessagesByCreatedAt = (
  persistedMessages: UIChatMessage[],
  localMessages: UIChatMessage[],
) => {
  const merged = [...persistedMessages];
  const sortedLocalMessages = [...localMessages].sort((a, b) => a.createdAt - b.createdAt);

  for (const localMessage of sortedLocalMessages) {
    const insertionIndex = merged.findIndex(
      (message) => message.createdAt > localMessage.createdAt,
    );

    if (insertionIndex === -1) merged.push(localMessage);
    else merged.splice(insertionIndex, 0, localMessage);
  }

  return merged;
};
