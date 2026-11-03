'use client';

import { AgentModalProvider } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import { NAV_PANEL_MESSAGES_KEY } from '@/features/NavPanel/railRouteKey';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';
import { MessageSearchProvider } from './SearchContext';

export { default as ConversationRow } from './ConversationRow';
export { ListHeader } from './Header';
export { AVATAR_SIZE } from './style';

/**
 * Messages tab list column: the IM-style conversation list (Lobe AI, agents
 * and groups by latest activity). Owned by the shell so it stays mounted
 * across chats. Each row opens its conversation as a channel.
 */
const MessageListPortal = () => (
  <NavPanelPortal navKey={NAV_PANEL_MESSAGES_KEY}>
    <AgentModalProvider>
      <MessageSearchProvider>
        <SideBarLayout body={<Body />} header={<Header />} />
      </MessageSearchProvider>
    </AgentModalProvider>
  </NavPanelPortal>
);

export default MessageListPortal;
