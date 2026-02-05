'use client';

import { Flexbox } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { memo } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';
import { AssistantNavKey } from '@/types/discover';

import Sidebar from '../Sidebar';
import Capabilities from './Capabilities';
import Nav from './Nav';
import Overview from './Overview';
import Related from './Related';
import SystemRole from './SystemRole';
import Versions from './Versions';

const Details = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { mobile = isMobile } = useResponsive();
  const [activeTab, setActiveTab] = useQueryState('activeTab', {
    clearOnDefault: true,
    defaultValue: AssistantNavKey.Overview,
  });

  return (
    <Flexbox gap={24}>
      <Nav activeTab={activeTab as AssistantNavKey} mobile={mobile} setActiveTab={setActiveTab} />
      <Flexbox
        gap={48}
        horizontal={!mobile}
        style={mobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox
          width={'100%'}
          style={{
            overflow: 'hidden',
          }}
        >
          {activeTab === AssistantNavKey.Overview && <Overview />}
          {activeTab === AssistantNavKey.SystemRole && <SystemRole />}
          {activeTab === AssistantNavKey.Capabilities && <Capabilities />}
          {activeTab === AssistantNavKey.Version && <Versions />}
          {activeTab === AssistantNavKey.Related && <Related />}
        </Flexbox>
        <Sidebar mobile={mobile} />
      </Flexbox>
    </Flexbox>
  );
});

export default Details;
