import type { ConversationContext } from '@lobechat/types';

import { isPartialHeadWindow } from '@/services/message/roundCursorPage';
import { displayMessageSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';

// Returns whether the history was re-read, so callers re-select their message list.
export const ensureFullHistoryForClientRun = async (
  context: ConversationContext,
  refreshMessages: (context: ConversationContext) => Promise<void>,
): Promise<boolean> => {
  if (!isPartialHeadWindow(context)) return false;

  try {
    await refreshMessages(context);
  } catch (error) {
    console.warn('[ensureFullHistoryForClientRun] Failed to reload a partial head window:', error);
  }
  return true;
};

export const readClientRunMessages = async (
  get: () => ChatStore,
  context: ConversationContext,
  chatKey: string,
) => {
  await ensureFullHistoryForClientRun(context, get().refreshMessages);
  return displayMessageSelectors.getDisplayMessagesByKey(chatKey)(get());
};
