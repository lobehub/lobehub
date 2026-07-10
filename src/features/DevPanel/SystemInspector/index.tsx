'use client';

import { Flexbox } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { useState } from 'react';

import AiProviderRuntimeConfig from './AiProviderRuntimeConfig';
import { AIProvider, DefaultAgentConfig, ServerConfig, SystemAgent } from './ServerConfig';

enum TabKey {
  AIProvider = 'aiProvider',
  AiProviderRuntimeConfig = 'aiProviderRuntimeConfig',
  DefaultAgentConfig = 'defaultAgentConfig',
  ServerConfig = 'serverConfig',
  SystemAgent = 'systemAgent',
}

const SystemInspector = () => {
  const [activeTab, setActiveTab] = useState<TabKey>(TabKey.ServerConfig);

  return (
    <Flexbox gap={4} height={'100%'}>
      <Tabs
        activeKey={activeTab}
        items={[
          {
            key: TabKey.AiProviderRuntimeConfig,
            label: 'Ai Provider Runtime Config',
          },
          {
            key: TabKey.AIProvider,
            label: 'AI Provider Config',
          },

          {
            key: TabKey.DefaultAgentConfig,
            label: 'Default Agent Config',
          },
          {
            key: TabKey.SystemAgent,
            label: 'System Agent',
          },
          {
            key: TabKey.ServerConfig,
            label: 'Server Config',
          },
        ]}
        onChange={(activeTab) => setActiveTab(activeTab as TabKey)}
      />

      {activeTab === TabKey.AiProviderRuntimeConfig && <AiProviderRuntimeConfig />}
      {activeTab === TabKey.DefaultAgentConfig && <DefaultAgentConfig />}
      {activeTab === TabKey.SystemAgent && <SystemAgent />}
      {activeTab === TabKey.AIProvider && <AIProvider />}
      {activeTab === TabKey.ServerConfig && <ServerConfig />}
    </Flexbox>
  );
};

export default SystemInspector;
