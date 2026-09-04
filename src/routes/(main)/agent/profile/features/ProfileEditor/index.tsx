'use client';

import { isDesktop } from '@lobechat/const';
import {
  isHeterogeneousProviderBindingSupported,
  isRemoteHeterogeneousType,
  isServerDefaultHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { HeterogeneousApiConfig, HeterogeneousAuthMode } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import type { TabsItem } from '@lobehub/ui/base-ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Wrench } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveServerDefaultAgentModels } from '@/features/HeterogeneousAgent/modelPicker';
import ModelSelect from '@/features/ModelSelect';
import RunPriorityHint from '@/features/ProfileEditor/AgentUserTools/RunPriorityHint';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
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
    padding: 24px;
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
  const heterogeneousProvider = config?.agencyConfig?.heterogeneousProvider;
  const { agencyConfig: effectiveAgencyConfig, workspaceScoped } =
    useEffectiveAgencyConfig(agentId);

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

  const updateHeterogeneousAuthMode = async (
    authMode: HeterogeneousAuthMode,
    apiConfig?: HeterogeneousApiConfig,
  ) => {
    if (!canEdit || !heterogeneousProvider) return;
    await updateAgentConfigById(agentId, {
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, apiConfig, authMode },
      },
    });
  };

  const updateHeterogeneousApiConfig = async (apiConfig: HeterogeneousApiConfig | undefined) => {
    if (!canEdit || !heterogeneousProvider) return;
    await updateAgentConfigById(agentId, {
      agencyConfig: {
        heterogeneousProvider: { ...heterogeneousProvider, apiConfig },
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
  const localDesktopAvailable =
    isDesktop &&
    !!heterogeneousProvider &&
    isHeterogeneousProviderBindingSupported(heterogeneousProvider.type) &&
    resolveExecutionTarget(effectiveAgencyConfig, {
      clientExecutionAvailable: true,
      isHetero: true,
      workspaceScoped,
    }) === 'local';
  // Workspace agents are excluded even when the author could spawn them
  // locally: the binding UI would list workspace-scoped providers, but Desktop
  // main resolves the reference in the personal scope only (see
  // `selectRuntimeType`'s personal-scope guard). The deployment-default API
  // source is not a user-provider binding, so it stays available whenever
  // local Desktop execution is available.
  const apiModeAvailable = localDesktopAvailable && !isWorkspaceAgent;
  const useFetchServerDefaultCapability = useAgentStore(
    (s) => s.useFetchServerDefaultHeterogeneousCapability,
  );
  // The shared matrix owns which native drivers can reach the deployment relay;
  // model/runtime compatibility continues to come from the server capability below.
  const serverDefaultAgentType =
    heterogeneousProvider && isServerDefaultHeterogeneousAgentType(heterogeneousProvider.type)
      ? heterogeneousProvider.type
      : undefined;
  const serverCapabilityEnabled = localDesktopAvailable && !!serverDefaultAgentType;
  const serverCapability = useFetchServerDefaultCapability(serverCapabilityEnabled);
  const serverDefaultModels =
    serverCapability.data?.enabled === true && serverDefaultAgentType
      ? resolveServerDefaultAgentModels(serverCapability.data.models, serverDefaultAgentType)
      : [];
  const serverDefaultAvailable = serverCapabilityEnabled && serverDefaultModels.length > 0;
  const serverDefaultUnavailableReason = !localDesktopAvailable
    ? t('heterogeneousStatus.apiMode.localOnly')
    : serverCapability.error
      ? t('heterogeneousStatus.apiMode.serverDefault.loadFailed')
      : serverCapability.data?.enabled === false
        ? t(
            serverCapability.data.reason === 'disabled'
              ? 'heterogeneousStatus.apiMode.serverDefault.disabled'
              : 'heterogeneousStatus.apiMode.serverDefault.invalidConfiguration',
          )
        : serverCapabilityEnabled && !serverCapability.isLoading && !serverDefaultAvailable
          ? t('heterogeneousStatus.apiMode.serverDefault.unsupported')
          : undefined;
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
              apiModeAvailable={apiModeAvailable}
              apiModeWorkspaceBlocked={isWorkspaceAgent}
              provider={heterogeneousProvider}
              serverDefaultAvailable={serverDefaultAvailable}
              serverDefaultLoading={serverCapabilityEnabled && serverCapability.isLoading}
              serverDefaultModels={serverDefaultModels}
              serverDefaultUnavailableReason={serverDefaultUnavailableReason}
              onApiConfigChange={updateHeterogeneousApiConfig}
              onAuthModeChange={updateHeterogeneousAuthMode}
              onCommandChange={updateHeterogeneousCommand}
              onServerDefaultRetry={() => {
                void serverCapability.mutate();
              }}
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
