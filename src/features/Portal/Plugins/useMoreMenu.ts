import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

export const useToolUIMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const messageId = useChatStore(chatPortalSelectors.toolMessageId);

  if (!messageId) return;

  // The view renders one tool-call message: its id is the only handle. The
  // content is derived live from the chat store, so there is nothing to refresh.
  return { copyId: messageId };
};
