'use client';

import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { Flexbox } from '@lobehub/ui';
import { Tabs, type TabsItem } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSelect from '@/features/ModelSelect';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';
import CloudHeterogeneousConfig from './CloudHeterogeneousConfig';
import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';
import RemoteAgentConfigCard from './RemoteAgentConfigCard';

const styles = createStaticStyles(({ css }) => ({
  configLabel: css`
    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};
  `,
  configPanel: css`
    padding-block: 12px;
    padding-inline: 14px;
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
        {isRemoteHetero && heterogeneousProvider ? (
          // Remote platform agents (openclaw / hermes): show device config panel
          <Flexbox paddingBlock={'8px 0'}>
            <RemoteAgentConfigCard
              provider={heterogeneousProvider}
              onBoundDeviceChange={updateBoundDeviceId}
            />
          </Flexbox>
        ) : isHeterogeneous && heterogeneousProvider ? (
          // Local CLI agents: Claude Code supports cloud config; Codex is desktop-only for now.
          <Tabs
            defaultActiveKey={isDesktop || !showCloudHeterogeneousTab ? 'desktop' : 'cloud'}
            items={heterogeneousTabItems}
            size="small"
          />
        ) : (
          <>
            <Flexbox className={styles.configPanel} gap={10}>
              <div className={styles.configLabel}>{t('settingAgent.runtimeConfig.title')}</div>
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

                    updateConfig(value);
                  }}
                />
                <AgentTool />
              </Flexbox>
            </Flexbox>
          </>
        )}
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
