import { Flexbox } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { useQueryState } from 'nuqs';
import { memo } from 'react';

import Sidebar from '../Sidebar';
import Nav, { GroupAgentNavKey } from './Nav';
import Overview from './Overview';
import SystemRole from './SystemRole';
import Versions from './Versions';

const Details = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { mobile = isMobile } = useResponsive();
  const [activeTabParam, setActiveTab] = useQueryState('activeTab');
  const activeTab = activeTabParam || GroupAgentNavKey.Overview;

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
          style={{
            overflow: 'hidden',
          }}
          width={'100%'}
        >
          {/* Tab Content */}
          {activeTab === GroupAgentNavKey.Overview && <Overview />}
          {activeTab === GroupAgentNavKey.SystemRole && <SystemRole />}
          {activeTab === GroupAgentNavKey.Versions && <Versions />}
        </Flexbox>

        {/* Sidebar */}
        <Sidebar mobile={mobile} />
      </Flexbox>
    </Flexbox>
  );
});

export default Details;
