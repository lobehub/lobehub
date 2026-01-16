import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useQueryState } from 'nuqs';

import { useResponsive } from '@/hooks/useResponsive';

import Nav, { GroupAgentNavKey } from './Nav';
import Overview from './Overview';
import Members from './Members';
import Versions from './Versions';
import Sidebar from '../Sidebar';

const Details = memo(() => {
  const { mobile } = useResponsive();
  const [activeTab = GroupAgentNavKey.Overview] = useQueryState('activeTab');

  return (
    <Flexbox gap={24} horizontal={!mobile} style={{ position: 'relative' }}>
      {/* Main Content */}
      <Flexbox flex={1} gap={16} style={{ minWidth: 0 }}>
        <Nav />

        {/* Tab Content */}
        {activeTab === GroupAgentNavKey.Overview && <Overview />}
        {activeTab === GroupAgentNavKey.Members && <Members />}
        {activeTab === GroupAgentNavKey.Versions && <Versions />}
      </Flexbox>

      {/* Sidebar - desktop only for most content */}
      {!mobile && (
        <Flexbox
          gap={16}
          style={{
            maxHeight: 'calc(100vh - 76px)',
            overflow: 'auto',
            position: 'sticky',
            top: 76,
            width: 320,
          }}
        >
          <Sidebar activeTab={activeTab as GroupAgentNavKey} />
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default Details;
