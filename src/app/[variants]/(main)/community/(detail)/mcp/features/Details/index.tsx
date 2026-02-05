'use client';

import { Flexbox } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { memo } from 'react';

import Agents from '@/features/MCPPluginDetail/Agents';
import Deployment from '@/features/MCPPluginDetail/Deployment';
import Nav from '@/features/MCPPluginDetail/Nav';
import Overview from '@/features/MCPPluginDetail/Overview';
import Schema from '@/features/MCPPluginDetail/Schema';
import Score from '@/features/MCPPluginDetail/Score';
import { useQueryState } from '@/hooks/useQueryParam';
import { McpNavKey } from '@/types/discover';

import Sidebar from '../Sidebar';
import Related from './Related';
import Versions from './Versions';

interface DetailsProps {
  mobile?: boolean;
}

const Details = memo<DetailsProps>(({ mobile: isMobile }) => {
  const { mobile = isMobile } = useResponsive();
  const [activeTab, setActiveTab] = useQueryState('activeTab', {
    clearOnDefault: true,
    defaultValue: McpNavKey.Overview,
  });

  return (
    <Flexbox gap={24}>
      <Nav
        noSettings
        activeTab={activeTab as McpNavKey}
        mobile={mobile}
        setActiveTab={setActiveTab}
      />
      <Flexbox
        gap={48}
        horizontal={!mobile}
        style={mobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox
          flex={1}
          width={'100%'}
          style={{
            overflow: 'hidden',
          }}
        >
          {activeTab === McpNavKey.Overview && <Overview />}
          {activeTab === McpNavKey.Deployment && <Deployment mobile={mobile} />}
          {activeTab === McpNavKey.Schema && <Schema />}
          {activeTab === McpNavKey.Related && <Related />}
          {activeTab === McpNavKey.Score && <Score />}
          {activeTab === McpNavKey.Agents && <Agents />}
          {activeTab === McpNavKey.Version && <Versions />}
        </Flexbox>
        <Sidebar mobile={mobile} />
      </Flexbox>
    </Flexbox>
  );
});

export default Details;
