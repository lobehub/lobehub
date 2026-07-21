'use client';

import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { Flexbox } from '@lobehub/ui';
import type { TabsItem } from '@lobehub/ui/base-ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Wrench } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSelect from '@/features/ModelSelect';
import RunPriorityHint from '@/features/ProfileEditor/AgentUserTools/RunPriorityHint';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';

import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';
import CloudHeterogeneousConfig from './CloudHeterogeneousConfig';
import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';
import RemoteAgentConfigCard from './RemoteAgentConfigCard';
import WorkspaceAgentDevicePolicy from './WorkspaceAgentDevicePolicy';
import { WorkspaceAgentModelPolicy } from './WorkspaceAgentModelPolicy';
import { WorkspaceAgentPolicyCard } from './WorkspaceAgentPolicyCard';

const styles = createStaticStyles(({ css }) => ({
  configLabel: css`
    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  configStack: css`
    container-type: inline-size;
  `,
  configPanel: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  topArea: css`
    cursor: default;
    margin-block-end: 28px;
  `,
}));

const ProfileEditor = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const heterogeneousProvider = config.agencyConfig?.heterogeneousProvider;

  const updateHeterogeneousCommand = async (command: string) => {
    if (!canEdit) return;
    if (!heterogeneousProvider) return;
    await updateAgentConfigById(agentId, {
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, command },
      },
    });
  };

  const updateHeterogeneousEnv = async (env: Record<string, string>) => {
    if (!canEdit) return;
    if (!heterogeneousProvider) return;
    await updateAgentConfigById(agentId, {
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, env },
      },
    });
  };

  const updateBoundDeviceId = async (boundDeviceId: string) => {
    await updateAgentConfigById(agentId, {
      agencyConfig: { ...config.agencyConfig, boundDeviceId, executionTarget: 'device' },
    });
  };

  const isRemoteHetero =
    isHeterogeneous &&
    !!heterogeneousProvider &&
    isRemoteHeterogeneousType(heterogeneousProvider.type);
  const showCloudHeterogeneousTab = heterogeneousProvider?.type === 'claude-code';
  const heterogeneousTabItems: TabsItem[] = heterogeneousProvider
    ? [
        ...(showCloudHeterogeneousTab
          ? [
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
            ]
          : []),
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
      ]
    : [];

  return (
    <>
      <Flexbox
        className={styles.topArea}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Header: Avatar + Name + Description */}
        <AgentHeader />
        <Flexbox
          className={styles.configStack}
          gap={8}
          paddingBlock={isRemoteHetero ? '8px 0' : undefined}
        >
          {isRemoteHetero && heterogeneousProvider ? (
            // Remote platform agents (openclaw / hermes): show device config panel
            <RemoteAgentConfigCard
              provider={heterogeneousProvider}
              onBoundDeviceChange={updateBoundDeviceId}
            />
          ) : isHeterogeneous && heterogeneousProvider ? (
            // Local CLI agents: Claude Code supports cloud config; Codex is desktop-only for now.
            <Tabs
              defaultActiveKey={isDesktop || !showCloudHeterogeneousTab ? 'desktop' : 'cloud'}
              items={heterogeneousTabItems}
              size="small"
            />
          ) : isWorkspaceAgent ? (
            <>
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                <WorkspaceAgentModelPolicy agentId={agentId} />
                <WorkspaceAgentDevicePolicy agentId={agentId} />
              </Flexbox>
              <WorkspaceAgentPolicyCard
                fullWidth
                action={<RunPriorityHint agentId={agentId} />}
                icon={Wrench}
                title={t('settingAgent.toolsConfig.title')}
              >
                <AgentTool />
              </WorkspaceAgentPolicyCard>
            </>
          ) : (
            <Flexbox className={styles.configPanel} gap={10}>
              <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
                <div className={styles.configLabel}>{t('settingAgent.runtimeConfig.title')}</div>
                <RunPriorityHint agentId={agentId} />
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={12} justify={'flex-start'} wrap={'wrap'}>
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

                    void updateAgentConfigById(agentId, value);
                  }}
                />
              </Flexbox>
              <AgentTool />
            </Flexbox>
          )}
          {isHeterogeneous ? (
            <WorkspaceAgentDevicePolicy agentId={agentId} showDevicePicker={!isRemoteHetero} />
          ) : null}
        </Flexbox>
      </Flexbox>
      {/* Main Content: Prompt Editor — built-in model runtime only. Hetero agents
          (Claude Code / Codex + remote platforms) run an external CLI with its own
          system prompt, so the agent's systemRole never reaches them. Hide the
          editor here to avoid a control that looks effective but isn't (mirrors the
          ModelSelect hiding above). */}
      {!isHeterogeneous && <EditorCanvas />}
    </>
  );
});

export default ProfileEditor;
