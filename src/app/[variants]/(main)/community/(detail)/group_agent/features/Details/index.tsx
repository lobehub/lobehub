import { Flexbox } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { useQueryState } from 'nuqs';
import { memo } from 'react';

import Nav, { GroupAgentNavKey } from './Nav';
import Members from './Members';
import Overview from './Overview';
import Versions from './Versions';
import Sidebar from '../Sidebar';

const Details = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { mobile = isMobile } = useResponsive();
  const [activeTab = GroupAgentNavKey.Overview, setActiveTab] = useQueryState('activeTab');

  return (
    <Flexbox gap={24}>
      {/* Navigation */}
      <Nav
        activeTab={activeTab as GroupAgentNavKey}
        mobile={mobile}
        setActiveTab={(tab) => setActiveTab(tab)}
      />

      <Flexbox
        gap={48}
        horizontal={!mobile}
        style={mobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        {/* Main Content */}
        <Flexbox
          flex={1}
          gap={16}
          style={{
            overflow: 'hidden',
          }}
          width={'100%'}
        >
          {/* Tab Content */}
          {activeTab === GroupAgentNavKey.Overview && <Overview />}
          {activeTab === GroupAgentNavKey.Members && <Members />}
          {activeTab === GroupAgentNavKey.Versions && <Versions />}
        </Flexbox>

        {/* Sidebar */}
        <Flexbox gap={16} width={mobile ? '100%' : 360}>
          <Sidebar mobile={mobile} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Details;
