import type { ConversationContext, UIChatMessage } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { messageListKey } from '@/services/message/cache';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/**
 * Resolve the first render's message snapshot without waiting for the
 * ConversationStore to project the same hydrated SWR entry back to ChatStore.
 * Live ChatStore state always wins so persisted data cannot replace optimistic
 * or streaming messages.
 */
export const useHydratedConversationMessages = (context: ConversationContext) => {
  const chatKey = messageMapKey(context);
  const storeMessages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const { data: hydratedMessages } = useClientDataSWR<UIChatMessage[]>(
    context.agentId && context.topicId ? messageListKey(context) : null,
    null,
  );

  return storeMessages ?? hydratedMessages;
};
