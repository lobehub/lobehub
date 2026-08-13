import { type ConversationContext } from '@lobechat/types';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

export const isSameConversationContext = (
  expected: ConversationContext,
  current: ConversationContext,
): boolean => messageMapKey(expected) === messageMapKey(current);
