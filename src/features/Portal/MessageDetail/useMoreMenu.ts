import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

export const useMessageDetailMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const [messageId, refreshMessages] = useChatStore((s) => [
    chatPortalSelectors.messageDetailId(s),
    s.refreshMessages,
  ]);

  if (!messageId) return;

  return {
    copyId: messageId,
    // The body reads the message out of the active conversation's list.
    refresh: () => refreshMessages(),
  };
};
