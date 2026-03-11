import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import { useQuery } from '@/hooks/useQuery';

import { GroupAgentNavKey } from '../Details/Nav';
import ActionButton from './ActionButton';
import Summary from './Summary';

const Sidebar = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { activeTab = GroupAgentNavKey.Overview } = useQuery() as { activeTab: GroupAgentNavKey };

  if (mobile) {
    return (
      <Flexbox gap={32}>
        <ActionButton mobile />
      </Flexbox>
    );
  }

  return (
    <ScrollShadow
      hideScrollBar
      flex={'none'}
      gap={32}
      size={4}
      width={360}
      style={{
        maxHeight: 'calc(100vh - 76px)',
        paddingBottom: 24,
        position: 'sticky',
        top: 16,
      }}
    >
      <ActionButton />
      {activeTab !== GroupAgentNavKey.Overview && <Summary />}
    </ScrollShadow>
  );
});

export default Sidebar;
