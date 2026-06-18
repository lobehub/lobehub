'use client';

import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { Flexbox } from '@lobehub/ui';
import { Divider, Tabs } from 'antd';
import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import AgentSettings from '../AgentSettings';
import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';
import CloudHeterogeneousConfig from './CloudHeterogeneousConfig';
import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';
import RemoteAgentConfigCard from './RemoteAgentConfigCard';

const ProfileEditor = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const updateConfig = useAgentStore((s) => s.updateAgentConfig);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const heterogeneousProvider = config.agencyConfig?.heterogeneousProvider;

  const updateHeterogeneousCommand = async (command: string) => {
    if (!canEdit) return;
    if (!heterogeneousProvider) return;
    await updateConfig({
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, command },
      },
    });
  };

  const updateHeterogeneousEnv = async (env: Record<string, string>) => {
    if (!canEdit) return;
    if (!heterogeneousProvider) return;
    await updateConfig({
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, env },
      },
    });
  };

  const updateBoundDeviceId = async (boundDeviceId: string) => {
    await updateConfig({ agencyConfig: { ...config.agencyConfig, boundDeviceId } });
  };

  const isRemoteHetero =
    isHeterogeneous &&
    !!heterogeneousProvider &&
    isRemoteHeterogeneousType(heterogeneousProvider.type);

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
        {isRemoteHetero && heterogeneousProvider ? (
          // Remote platform agents (openclaw / hermes): show device config panel
          <Flexbox paddingBlock={'8px 0'}>
            <RemoteAgentConfigCard
              provider={heterogeneousProvider}
              onBoundDeviceChange={updateBoundDeviceId}
            />
          </Flexbox>
        ) : isHeterogeneous && heterogeneousProvider ? (
          // Local CLI agents (claude-code, codex): tabs for cloud (web) and desktop environments
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
                disabled={!canEdit}
                popupWidth={400}
                value={{
                  model: config.model,
                  provider: config.provider,
                }}
                onChange={(value) => {
                  if (!canEdit) return;

                  updateConfig(value);
                }}
              />
            </Flexbox>
            <AgentTool />
          </>
        )}
      </Flexbox>
      <Divider />
      {/* Main Content: Prompt Editor */}
      <EditorCanvas />
      {/* Advanced Settings Modal */}
      <AgentSettings />
    </>
  );
});

export default ProfileEditor;
