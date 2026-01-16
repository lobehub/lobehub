import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { GroupAgentNavKey } from '../Details/Nav';
import ActionButton from './ActionButton';

interface SidebarProps {
  activeTab: GroupAgentNavKey;
}

const Sidebar = memo<SidebarProps>(({ activeTab }) => {
  return (
    <Flexbox gap={16}>
      {/* Action Button - always visible */}
      <ActionButton />

      {/* TODO: Add more sidebar content */}
      {/* - Summary (for non-Overview tabs) */}
      {/* - Related Groups */}
    </Flexbox>
  );
});

export default Sidebar;
