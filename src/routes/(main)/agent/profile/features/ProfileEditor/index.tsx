'use client';

import { isDesktop } from '@lobechat/const';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { getHeterogeneousAgentClientConfig } from '@lobechat/heterogeneous-agents/client';
import { Flexbox } from '@lobehub/ui';
import type { TabsItem } from '@lobehub/ui/base-ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Wrench } from 'lucide-react';
import React, { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DeviceTabLabel } from '@/features/DeviceManager/deviceStatus';
import HeterogeneousAgentStatusCard from '@/features/DeviceManager/HeterogeneousAgentStatusCard';
import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import ModelSelect from '@/features/ModelSelect';
import RunPriorityHint from '@/features/ProfileEditor/AgentUserTools/RunPriorityHint';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';

import EditorCanvas from '../EditorCanvas';
import AgentHeader from './AgentHeader';
import AgentTool from './AgentTool';
import CloudHeterogeneousConfig from './CloudHeterogeneousConfig';
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
    padding: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  deviceEmpty: css`
    padding-block: 16px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
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
  const heterogeneousProvider = config?.agencyConfig?.heterogeneousProvider;

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
      agencyConfig: { ...config?.agencyConfig, boundDeviceId, executionTarget: 'device' },
    });
  };

  const isRemoteHetero =
    isHeterogeneous &&
    !!heterogeneousProvider &&
    isRemoteHeterogeneousType(heterogeneousProvider.type);
  const showCloudHeterogeneousTab = heterogeneousProvider?.type === 'claude-code';

  // Every device the user can pick as this agent's execution target: personal
  // machines for personal agents, workspace machines for workspace agents
  // (mirrors the conversation page's execution-target picker scoping). The
  // current machine's gateway deviceId (desktop only) is used to skip the
  // local machine's own row — it gets a fixed first tab instead, whether or
  // not the gateway is connected.
  const gatewayInfo = useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  const { data: devices } = useDeviceList();
  const agentDevices = useMemo(() => {
    const list = devices ?? [];
    return isWorkspaceAgent
      ? list.filter((device) => device.scope === 'workspace')
      : list.filter((device) => device.scope === 'personal');
  }, [devices, isWorkspaceAgent]);

  // Active tab key, derived so the default lands on the local machine tab
  // (desktop) or the first device as soon as the pool loads (no flash), keeps
  // the Cloud tab when the user is on it, and falls back to the Cloud tab
  // when that is all there is on web.
  const [activeHeteroTabKey, setActiveHeteroTabKey] = useState<string>();
  const resolvedActiveTabKey =
    activeHeteroTabKey === 'cloud' ||
    activeHeteroTabKey === 'local' ||
    agentDevices.some((device) => device.deviceId === activeHeteroTabKey)
      ? activeHeteroTabKey
      : isDesktop
        ? 'local'
        : ((agentDevices.find((device) => device.deviceId === currentDeviceId) ?? agentDevices[0])
            ?.deviceId ?? (showCloudHeterogeneousTab ? 'cloud' : 'desktop'));

  // Provider config and device tabs are built only when a provider is
  // configured — `heterogeneousProvider` is `undefined` for built-in agents
  // and while the agent config is still loading, and the guarded render
  // branch below is the only consumer of these tabs. Building them up front
  // with a non-null assertion would crash the whole profile editor for any
  // non-heterogeneous agent.
  const heterogeneousTabItems: TabsItem[] = heterogeneousProvider
    ? (() => {
        const cloudTab: TabsItem = {
          key: 'cloud',
          label: t('heterogeneousStatus.cloud.tabLabel'),
          children: (
            <CloudHeterogeneousConfig
              provider={heterogeneousProvider}
              onEnvChange={updateHeterogeneousEnv}
            />
          ),
        };

        // The resolved launch command, shared by the local tab and the device
        // tabs (their status dots probe the local CLI over IPC).
        const providerConfig = getHeterogeneousAgentClientConfig(heterogeneousProvider.type);
        const resolvedCommand =
          heterogeneousProvider.command?.trim() || providerConfig?.defaultCommand || '';

        const deviceTabs: TabsItem[] = [
          // The local machine always leads the row — its card is probed over
          // Electron IPC, so it works even when the gateway is down and the
          // device list has no row for this machine. The machine's own list
          // row (if any) is skipped below to avoid a duplicate tab.
          ...(isDesktop
            ? [
                {
                  key: 'local',
                  label: (
                    <DeviceTabLabel
                      agentType={heterogeneousProvider.type}
                      command={resolvedCommand}
                      currentDeviceId={currentDeviceId}
                    />
                  ),
                  children: (
                    <HeterogeneousAgentStatusCard
                      provider={heterogeneousProvider}
                      onCommandChange={updateHeterogeneousCommand}
                    />
                  ),
                },
              ]
            : []),
          // One tab per remaining device — the label carries the CLI status
          // dot and clicking a tab switches the whole status card below to
          // that device. While the gateway device info is still resolving,
          // `currentDeviceId` is unknown: rendering the device rows then
          // would make the local machine's own row look like a remote device
          // and probe it through the gateway. The local machine must never go
          // through the gateway, so its row is skipped (via `currentDeviceId`)
          // and the whole list waits for it on desktop.
          ...(isDesktop && gatewayInfo.isLoading
            ? []
            : agentDevices
                .filter((device) => device.deviceId !== currentDeviceId)
                .map((device) => ({
                  key: device.deviceId,
                  label: (
                    <DeviceTabLabel
                      agentType={heterogeneousProvider.type}
                      command={resolvedCommand}
                      currentDeviceId={currentDeviceId}
                      device={device}
                    />
                  ),
                  children: (
                    <HeterogeneousAgentStatusCard
                      device={device}
                      provider={heterogeneousProvider}
                      onCommandChange={updateHeterogeneousCommand}
                    />
                  ),
                }))),
        ];

        return [...(showCloudHeterogeneousTab ? [cloudTab] : []), ...deviceTabs];
      })()
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
            // Local CLI agents: Claude Code keeps its Cloud tab; the other
            // tabs are one per device. On web with no connected device and no
            // Cloud config there is no CLI to inspect anywhere, so show a
            // connect hint instead of the tabs.
            heterogeneousTabItems.length === 0 ? (
              <Flexbox className={styles.deviceEmpty}>
                {t('heterogeneousStatus.devices.empty')}
              </Flexbox>
            ) : (
              <Tabs
                activeKey={resolvedActiveTabKey}
                items={heterogeneousTabItems}
                size="small"
                onChange={(key) => setActiveHeteroTabKey(key)}
              />
            )
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
                    model: config?.model,
                    provider: config?.provider,
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
