'use client';

import { isDesktop } from '@lobechat/const';
import {
  HETEROGENEOUS_TYPE_LABELS,
  isHeterogeneousProviderBindingSupported,
  isRemoteHeterogeneousType,
  isServerDefaultHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { HeterogeneousApiConfig, HeterogeneousAuthMode } from '@lobechat/types';
import { Alert, Button, createStaticStyles, cssVar, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ChevronDown, MonitorSmartphone, Wrench } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AGENT_SHARE_ALLOWED_PROVIDERS } from '@/business/agent-share';
import { useAgentShareSupported } from '@/business/client/useAgentShareSupported';
import { ModelIcon } from '@/components/LobeIcons';
import { DeviceCliStatusCard } from '@/features/HeterogeneousAgent/ExecutionEnvironment/DeviceCliStatusCard';
import { HeteroExecutionTargetSelect } from '@/features/HeterogeneousAgent/ExecutionEnvironment/HeteroExecutionTargetSelect';
import { useProfileExecutionTarget } from '@/features/HeterogeneousAgent/ExecutionEnvironment/useProfileExecutionTarget';
import { resolveServerDefaultAgentModels } from '@/features/HeterogeneousAgent/modelPicker';
import ReasoningEffortSelect from '@/features/ModelSelect/ReasoningEffortSelect';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import RunPriorityHint from '@/features/ProfileEditor/AgentUserTools/RunPriorityHint';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

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
  const { t } = useTranslation(['setting', 'agent']);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const { isShared } = useAgentShareSupported(agentId);
  const chatModels = useEnabledChatModels();
  const enabledList =
    isShared && AGENT_SHARE_ALLOWED_PROVIDERS
      ? chatModels.filter((provider) => AGENT_SHARE_ALLOWED_PROVIDERS?.includes(provider.id))
      : undefined;
  const selectedModel = useAiInfraStore(
    aiModelSelectors.getEnabledModelById(config?.model ?? '', config?.provider ?? ''),
  );
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const heterogeneousProvider = config?.agencyConfig?.heterogeneousProvider;
  // Where this caller's new topics run. The environment picker and the panel
  // below both follow it, so the panel never describes this client by default.
  const executionTarget = useProfileExecutionTarget(agentId);

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
  const localDesktopAvailable =
    isDesktop && !!heterogeneousProvider && executionTarget.target === 'local';
  // Workspace agents are excluded even when the author could spawn them
  // locally: the binding UI would list workspace-scoped providers, but Desktop
  // main resolves the reference in the personal scope only (see
  // `selectRuntimeType`'s personal-scope guard). The deployment-default API
  // source is not a user-provider binding, so it stays available whenever
  // local Desktop execution is available.
  const apiModeAvailable =
    localDesktopAvailable &&
    !isWorkspaceAgent &&
    isHeterogeneousProviderBindingSupported(heterogeneousProvider.type);
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
  const serverCapabilitySync = useFetchServerDefaultCapability(serverCapabilityEnabled);
  // The last confirmed capability paints at once; the sync only confirms it, and
  // a failed background refresh keeps it instead of turning into an error.
  const serverCapability = useAgentStore(agentSelectors.heteroServerDefaultCapability);
  const serverCapabilityError = !serverCapability && serverCapabilitySync.error;
  const serverCapabilityLoading =
    serverCapabilityEnabled && !serverCapability && !serverCapabilitySync.error;
  const serverDefaultModels =
    serverCapability?.enabled === true && serverDefaultAgentType
      ? resolveServerDefaultAgentModels(serverCapability.models, serverDefaultAgentType)
      : [];
  const serverDefaultAvailable = serverCapabilityEnabled && serverDefaultModels.length > 0;
  const serverDefaultUnavailableReason = !localDesktopAvailable
    ? t('heterogeneousStatus.apiMode.localOnly')
    : serverCapabilityError
      ? t('heterogeneousStatus.apiMode.serverDefault.loadFailed')
      : serverCapability?.enabled === false
        ? t(
            serverCapability.reason === 'disabled'
              ? 'heterogeneousStatus.apiMode.serverDefault.disabled'
              : 'heterogeneousStatus.apiMode.serverDefault.invalidConfiguration',
          )
        : serverCapabilityEnabled && !serverCapabilityLoading && !serverDefaultAvailable
          ? t('heterogeneousStatus.apiMode.serverDefault.unsupported')
          : undefined;
  const renderHeterogeneousPanel = () => {
    // Until the member's own override loads, the target may still flip.
    if (!heterogeneousProvider || executionTarget.isPending) return null;

    const { panel } = executionTarget;

    switch (panel.kind) {
      case 'cloud': {
        return (
          <CloudHeterogeneousConfig
            provider={heterogeneousProvider}
            onEnvChange={updateHeterogeneousEnv}
          />
        );
      }
      case 'device': {
        return (
          <DeviceCliStatusCard
            deviceId={panel.deviceId}
            provider={heterogeneousProvider}
            onAuthModeChange={updateHeterogeneousAuthMode}
          />
        );
      }
      case 'local':
      case 'runtime': {
        return (
          <HeterogeneousAgentStatusCard
            apiModeAvailable={apiModeAvailable}
            apiModeWorkspaceBlocked={isWorkspaceAgent}
            provider={heterogeneousProvider}
            serverDefaultAvailable={serverDefaultAvailable}
            serverDefaultLoading={serverCapabilityLoading}
            serverDefaultModels={serverDefaultModels}
            serverDefaultUnavailableReason={serverDefaultUnavailableReason}
            onApiConfigChange={updateHeterogeneousApiConfig}
            onAuthModeChange={updateHeterogeneousAuthMode}
            onCommandChange={updateHeterogeneousCommand}
            onServerDefaultRetry={() => {
              void serverCapabilitySync.revalidate();
            }}
          />
        );
      }
      case 'sandbox': {
        return (
          <Alert
            showIcon
            type={'info'}
            title={t('heterogeneousStatus.sandbox.desc', {
              name: HETEROGENEOUS_TYPE_LABELS[heterogeneousProvider.type],
            })}
          />
        );
      }
      case 'pending': {
        return null;
      }
    }
  };

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
            // CLI agents: pick where new topics run, then configure that environment.
            <>
              <WorkspaceAgentPolicyCard
                fullWidth
                icon={MonitorSmartphone}
                title={t('settingAgent.devicePolicy.title')}
              >
                <HeteroExecutionTargetSelect
                  agentId={agentId}
                  deviceId={executionTarget.deviceId}
                  isOverridden={executionTarget.isOverridden}
                  isPending={executionTarget.isPending}
                  isSelectable={executionTarget.isSelectable}
                  providerType={heterogeneousProvider.type}
                  target={executionTarget.target}
                />
              </WorkspaceAgentPolicyCard>
              {renderHeterogeneousPanel()}
            </>
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
                <ModelSwitchPanel
                  enabledList={enabledList}
                  model={config?.model}
                  open={canEdit ? undefined : false}
                  openOnHover={false}
                  placement={'bottomLeft'}
                  provider={config?.provider}
                  notice={
                    enabledList && (
                      <Alert
                        showIcon
                        title={t('share.settings.modelRestriction.title', { ns: 'agent' })}
                        type={'info'}
                        description={t('share.settings.modelRestriction.description', {
                          ns: 'agent',
                        })}
                      />
                    )
                  }
                  onModelChange={async (value) => {
                    if (canEdit) await updateAgentConfigById(agentId, value);
                  }}
                >
                  <Button disabled={!canEdit}>
                    <ModelIcon model={config?.model} size={20} />
                    {selectedModel?.displayName || config?.model}
                    <ChevronDown size={14} />
                  </Button>
                </ModelSwitchPanel>
                {config?.model && config.provider && (
                  <ReasoningEffortSelect
                    disabled={!canEdit}
                    model={config.model}
                    provider={config.provider}
                  />
                )}
              </Flexbox>
              <AgentTool />
            </Flexbox>
          )}
          {isRemoteHetero ? (
            <WorkspaceAgentDevicePolicy agentId={agentId} showDevicePicker={false} />
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
