import { memo } from 'react';

import PortalHeader from '@/features/Portal/components/Header';
import { useChatStore } from '@/store/chat';

import Title from './Title';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const closeTopicPortal = useChatStore((s) => s.closeTopicPortal);

  // Closing pops only this topic view; a host-provided close (e.g. a drawer)
  // still wins so the host can tear itself down.
  return <PortalHeader title={<Title />} onClose={onClose ?? closeTopicPortal} />;
});

Header.displayName = 'PortalTopicHeader';

export default Header;
