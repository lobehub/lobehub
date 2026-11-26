import type { CompressionGroupMetadata, UIChatMessage } from '@lobechat/types';

const isCompressedGroup = (message: UIChatMessage) => message.role === 'compressedGroup';

const findLastUserIndex = (messages: UIChatMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }

  return -1;
};

/**
 * A compression group summarises the history *before* the turn that triggered
 * it, but the group is created while that turn is already running, so its
 * `createdAt` sorts it after the turn's user message. Rendered in that order the
 * summary card splits the question from its answer and reads like a reply of
 * its own.
 *
 * Place the group where its content belongs: directly above the user message
 * that follows the compressed history, so the answer stays attached to the
 * question. Groups that have no user message above them, or are marked
 * `keepPosition`, keep their position.
 */
export const hoistCompressedGroups = (messages: UIChatMessage[]): UIChatMessage[] => {
  if (!messages.some(isCompressedGroup)) return messages;

  const result: UIChatMessage[] = [];

  for (const message of messages) {
    if (!isCompressedGroup(message)) {
      result.push(message);
      continue;
    }

    const keepPosition = (message.metadata as CompressionGroupMetadata | undefined)?.keepPosition;
    const anchor = keepPosition ? -1 : findLastUserIndex(result);

    if (anchor === -1) {
      result.push(message);
    } else {
      result.splice(anchor, 0, message);
    }
  }

  return result;
};
