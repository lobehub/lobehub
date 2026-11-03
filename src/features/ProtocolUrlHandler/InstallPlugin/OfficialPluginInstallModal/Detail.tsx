'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';

import MCPInstallProgress from '@/features/MCP/MCPInstallProgress';
import Deployment from '@/features/MCPPluginDetail/Deployment';
import { type DetailContextConfig } from '@/features/MCPPluginDetail/DetailProvider';
import { DetailProvider } from '@/features/MCPPluginDetail/DetailProvider';
import Header from '@/features/MCPPluginDetail/Header';
import Nav from '@/features/MCPPluginDetail/Nav';
import Overview from '@/features/MCPPluginDetail/Overview';
import Schema from '@/features/MCPPluginDetail/Schema';
import Score from '@/features/MCPPluginDetail/Score';
import { McpNavKey } from '@/types/discover';

interface OfficialDetailProps {
  data: DetailContextConfig;
  identifier: string;
}

const OfficialDetail = memo<OfficialDetailProps>(({ data, identifier }) => {
  const [activeTab, setActiveTab] = useState(McpNavKey.Overview);

  return (
    <DetailProvider config={data}>
      <Flexbox gap={16}>
        <Header inModal />
        <MCPInstallProgress identifier={identifier} />

        <Nav inModal noSettings activeTab={activeTab as McpNavKey} setActiveTab={setActiveTab} />
        <Flexbox gap={24}>
          {activeTab === McpNavKey.Overview && <Overview inModal />}
          {activeTab === McpNavKey.Deployment && <Deployment />}
          {activeTab === McpNavKey.Schema && <Schema />}
          {activeTab === McpNavKey.Score && <Score />}
        </Flexbox>
      </Flexbox>
    </DetailProvider>
  );
});

OfficialDetail.displayName = 'OfficialDetail';

export default OfficialDetail;
