import { useLayoutEffect } from 'react';

import { isAcceptancePortalView } from '@/features/Home/acceptancePortalView';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

export const useAcceptancePanelOpen = () =>
  useChatStore((s) => isAcceptancePortalView(chatPortalSelectors.currentViewType(s)));

/** Whether a report is open beside this Channel, and how to close it. */
export const useAcceptancePanel = (channelId: string) => {
  const open = useAcceptancePanelOpen();
  const close = useChatStore((s) => s.clearPortalStack);
  // The portal stack is global: a view left open on another page, or by the previous
  // Channel, must not appear here.
  useLayoutEffect(() => {
    close();
    return close;
  }, [channelId, close]);
  return { close, open };
};
