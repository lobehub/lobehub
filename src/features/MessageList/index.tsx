'use client';

import { AgentModalProvider } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import { NAV_PANEL_MESSAGES_KEY } from '@/features/NavPanel/railRouteKey';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import Header from './Header';

export { default as ConversationRow } from './ConversationRow';
export { ListHeader } from './Header';
export { ConversationNestedPortal } from './NestedSlot';
export { AVATAR_SIZE } from './style';

/**
 * Messages tab list column: the IM-style conversation list (Lobe AI, agents
 * and groups by latest activity). Owned by the shell so it stays mounted
 * across chats; the routed chat's topics render nested under its row.
 */
const MessageListPortal = () => (
  <NavPanelPortal navKey={NAV_PANEL_MESSAGES_KEY}>
    <AgentModalProvider>
      <SideBarLayout body={<Body />} header={<Header />} />
    </AgentModalProvider>
  </NavPanelPortal>
);

export default MessageListPortal;
