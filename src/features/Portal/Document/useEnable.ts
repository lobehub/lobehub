'use client';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

export const useEnable = () => {
  return useChatStore(chatPortalSelectors.showDocument);
};
