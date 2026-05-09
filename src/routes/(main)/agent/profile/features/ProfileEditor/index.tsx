'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Divider, Tabs } from 'antd';
import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import AgentCronJobs from '../AgentCronJobs';
import AgentSettings from '../AgentSettings';
import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';
import CloudHeterogeneousConfig from './CloudHeterogeneousConfig';
import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';

const ProfileEditor = memo(() => {
  const { t } = useTranslation('setting');
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const updateConfig = useAgentStore((s) => s.updateAgentConfig);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const heterogeneousProvider = config.agencyConfig?.heterogeneousProvider;

  const updateHeterogeneousCommand = async (command: string) => {
    if (!heterogeneousProvider) return;
    await updateConfig({
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, command },
      },
    });
  };

  const updateHeterogeneousEnv = async (env: Record<string, string>) => {
    if (!heterogeneousProvider) return;
    await updateConfig({
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, env },
      },
    });
  };

  return (
    <>
      <Flexbox
        style={{ cursor: 'default', marginBottom: 12 }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Header: Avatar + Name + Description */}
        <AgentHeader />
        {isHeterogeneous && heterogeneousProvider ? (
          // Heterogeneous integration mode: tabs for cloud (web) and desktop environments
          <Tabs
            defaultActiveKey={isDesktop ? 'desktop' : 'cloud'}
            size="small"
            items={[
              {
                key: 'cloud',
                label: t('heterogeneousStatus.cloud.tabLabel'),
                children: (
                  <CloudHeterogeneousConfig
                    provider={heterogeneousProvider}
                    onEnvChange={updateHeterogeneousEnv}
                  />
                ),
              },
              {
                key: 'desktop',
                label: t('heterogeneousStatus.desktop.tabLabel'),
                disabled: !isDesktop,
                children: (
                  <HeterogeneousAgentStatusCard
                    provider={heterogeneousProvider}
                    onCommandChange={updateHeterogeneousCommand}
                  />
                ),
              },
            ]}
          />
        ) : (
          <>
            {/* Config Bar: Model Selector */}
            <Flexbox
              horizontal
              align={'center'}
              gap={8}
              justify={'flex-start'}
              style={{ marginBottom: 12 }}
            >
              <ModelSelect
                initialWidth
                popupWidth={400}
                value={{
                  model: config.model,
                  provider: config.provider,
                }}
                onChange={updateConfig}
              />
            </Flexbox>
            <AgentTool />
          </>
        )}
      </Flexbox>
      <Divider />
      {/* Main Content: Prompt Editor */}
      <EditorCanvas />
      {/* Agent Cron Jobs Display (only show if jobs exist) */}
      {enableBusinessFeatures && <AgentCronJobs />}
      {/* Advanced Settings Modal */}
      <AgentSettings />
    </>
  );
});

export default ProfileEditor;
