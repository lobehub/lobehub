'use client';

import type { HeterogeneousProviderBillingType } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';

import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import AgentCronJobs from '../AgentCronJobs';
import AgentSettings from '../AgentSettings';
import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';
import type { ClaudeCodeApiProviderPreset } from './claudeCodeProviderPresets';
import { getClaudeCodeApiProviderPresetAvatar } from './claudeCodeProviderPresets';
import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';

const ProfileEditor = memo(() => {
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const updateConfig = useAgentStore((s) => s.updateAgentConfig);
  const updateMeta = useAgentStore((s) => s.updateAgentMeta);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const heterogeneousProvider = config.agencyConfig?.heterogeneousProvider;
  const updateHeterogeneousCommand = async (command: string) => {
    if (!heterogeneousProvider) return;

    await updateConfig({
      agencyConfig: {
        heterogeneousProvider: {
          ...heterogeneousProvider,
          command,
        },
      },
    });
  };
  const updateHeterogeneousEnv = async (env?: Record<string, string>) => {
    if (!heterogeneousProvider) return;

    await updateConfig({
      agencyConfig: {
        heterogeneousProvider: {
          ...heterogeneousProvider,
          env,
        },
      },
    });
  };
  const updateHeterogeneousBillingType = async (billingType: HeterogeneousProviderBillingType) => {
    if (!heterogeneousProvider) return;

    await updateConfig({
      agencyConfig: {
        heterogeneousProvider: {
          ...heterogeneousProvider,
          billingType,
          env: heterogeneousProvider.env,
        },
      },
    });
  };
  const updateHeterogeneousProviderAvatar = async (preset: ClaudeCodeApiProviderPreset) => {
    await updateMeta({ avatar: getClaudeCodeApiProviderPresetAvatar(preset) });
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
          // Heterogeneous integration mode: show provider CLI status instead of model/skills pickers
          <HeterogeneousAgentStatusCard
            provider={heterogeneousProvider}
            onBillingTypeChange={updateHeterogeneousBillingType}
            onCommandChange={updateHeterogeneousCommand}
            onEnvChange={updateHeterogeneousEnv}
            onProviderPresetChange={updateHeterogeneousProviderAvatar}
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
