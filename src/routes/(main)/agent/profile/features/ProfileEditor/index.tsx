'use client';

import { isDesktop } from '@lobechat/const';
import {
  HETEROGENEOUS_TYPE_LABELS,
  isHeterogeneousProviderBindingSupported,
  isRemoteHeterogeneousType,
  isServerDefaultHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { HeterogeneousApiConfig, HeterogeneousAuthMode } from '@lobechat/types';
import { Alert, createStaticStyles, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Fingerprint, MonitorSmartphone, Wrench } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeEntrypointSetting } from '@/features/HeterogeneousAgent/ClaudeCodeEntrypointSetting';
import { ApiAuthLocalOnlyNotice } from '@/features/HeterogeneousAgent/ExecutionEnvironment/ApiAuthLocalOnlyNotice';
import { DeviceCliStatusCard } from '@/features/HeterogeneousAgent/ExecutionEnvironment/DeviceCliStatusCard';
import { HeteroExecutionTargetSelect } from '@/features/HeterogeneousAgent/ExecutionEnvironment/HeteroExecutionTargetSelect';
import { useProfileExecutionTarget } from '@/features/HeterogeneousAgent/ExecutionEnvironment/useProfileExecutionTarget';
import { resolveServerDefaultAgentModels } from '@/features/HeterogeneousAgent/modelPicker';
import RunPriorityHint from '@/features/ProfileEditor/AgentUserTools/RunPriorityHint';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';

import EditorCanvas from '../EditorCanvas';
import { AgentConfigCard } from './AgentConfigCard';
import AgentExecutionEnvironment from './AgentExecutionEnvironment';
import AgentHeader from './AgentHeader';
import { AgentModelConfig } from './AgentModelConfig';
import AgentTool from './AgentTool';
import CloudHeterogeneousConfig from './CloudHeterogeneousConfig';
import HeterogeneousAgentStatusCard from './HeterogeneousAgentStatusCard';
import RemoteAgentConfigCard from './RemoteAgentConfigCard';

const styles = createStaticStyles(({ css }) => ({
  configStack: css`
    container-type: inline-size;
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
  const renderHeterogeneousPanelBody = () => {
    if (!heterogeneousProvider) return null;

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
        return <DeviceCliStatusCard deviceId={panel.deviceId} provider={heterogeneousProvider} />;
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

  const renderHeterogeneousPanel = () => {
    // Until the member's own override loads, the target may still flip.
    if (!heterogeneousProvider || executionTarget.isPending) return null;

    return (
      <>
        {/* Dispatch rejects API auth off this desktop, and only the local card
            edits auth — so every other environment offers the way back. */}
        {executionTarget.isApiAuthBlocked && (
          <ApiAuthLocalOnlyNotice
            onUseSubscription={
              canEdit
                ? () =>
                    void updateHeterogeneousAuthMode(
                      'subscription',
                      heterogeneousProvider.apiConfig,
                    )
                : undefined
            }
          />
        )}
        {renderHeterogeneousPanelBody()}
      </>
    );
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
              <AgentConfigCard
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
              </AgentConfigCard>
              {renderHeterogeneousPanel()}
              {/* Follows the engine and its sign-in, not where the run lands. */}
              {heterogeneousProvider.type === 'claude-code' &&
                (heterogeneousProvider.authMode ?? 'subscription') === 'subscription' && (
                  <AgentConfigCard
                    fullWidth
                    icon={Fingerprint}
                    title={t('heterogeneousStatus.entrypoint.label')}
                  >
                    <ClaudeCodeEntrypointSetting
                      disabled={!canEdit}
                      env={heterogeneousProvider.env}
                      onEnvChange={updateHeterogeneousEnv}
                    />
                  </AgentConfigCard>
                )}
            </>
          ) : (
            // Built-in runtime agents: the same cards in personal and workspace scope.
            <>
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                <AgentModelConfig agentId={agentId} />
                <AgentExecutionEnvironment agentId={agentId} />
              </Flexbox>
              <AgentConfigCard
                fullWidth
                action={<RunPriorityHint agentId={agentId} />}
                icon={Wrench}
                title={t('settingAgent.toolsConfig.title')}
              >
                <AgentTool />
              </AgentConfigCard>
            </>
          )}
          {isRemoteHetero && isWorkspaceAgent ? (
            <AgentExecutionEnvironment agentId={agentId} showDevicePicker={false} />
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
