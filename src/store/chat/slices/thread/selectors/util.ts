import { type IThreadType, type UIChatMessage } from '@lobechat/types';
import { ThreadType } from '@lobechat/types';

/**
 * Generate parent messages for thread display
 * Based on thread type:
 * - Standalone: only include the source message
 * - Continuation: include all messages up to and including the source message
 */
export const genParentMessages = (
  messages: UIChatMessage[],
  startMessageId: string | null | undefined,
  threadMode?: IThreadType,
) => {
  if (!startMessageId) return [];

  // In standalone thread mode, only show the thread's starting message
  if (threadMode === ThreadType.Standalone) {
    return messages.filter((m) => m.id === startMessageId);
  }

  // In continuation mode, show only the thread's starting message and the thread divider
  const targetIndex = messages.findIndex((item) => item.id === startMessageId);

  if (targetIndex < 0) return [];

  return messages.slice(0, targetIndex + 1);
};
