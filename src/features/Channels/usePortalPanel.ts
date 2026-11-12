import { useLayoutEffect } from 'react';

import { isAcceptancePortalView } from '@/features/Home/acceptancePortalView';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

/** Portal views a Channel shows beside its feed: a linked report, or a page in the side browser. */
export const isChannelPortalView = (viewType: PortalViewType | null) =>
  isAcceptancePortalView(viewType) || viewType === PortalViewType.Browser;

/** Each Channel browses in its own retained page, apart from every agent topic's. */
export const channelBrowserSessionId = (channelId: string) => `channel:${channelId}`;

export const usePortalPanelOpen = () =>
  useChatStore((s) => isChannelPortalView(chatPortalSelectors.currentViewType(s)));

/** Whether a portal view is open beside this Channel, and how to close it. */
export const usePortalPanel = (channelId: string) => {
  const open = usePortalPanelOpen();
  const close = useChatStore((s) => s.clearPortalStack);
  // The portal stack is global: a view left open on another page, or by the previous
  // Channel, must not appear here.
  useLayoutEffect(() => {
    close();
    return close;
  }, [channelId, close]);
  return { close, open };
};
