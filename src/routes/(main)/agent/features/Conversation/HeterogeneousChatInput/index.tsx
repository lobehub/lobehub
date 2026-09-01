'use client';

import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import { isHeteroSelectorAvailable } from '@lobechat/types';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHeteroAgentCloudConfig } from '@/business/client/hooks/useHeteroAgentCloudConfig';
import { isDesktop } from '@/const/version';
import { type ActionKeys } from '@/features/ChatInput';
import HeteroControlBar from '@/features/ChatInput/ControlBar/HeteroControlBar';
import HeteroModel from '@/features/ChatInput/ControlBar/HeteroModel';
import { ChatInput } from '@/features/Conversation';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useProviderBindingValidation } from '@/features/HeterogeneousAgent/hooks/useProviderBinding';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  isHeterogeneousSandboxExecutionAvailable,
  resolveExecutionTarget,
} from '@/helpers/executionTarget';
import { resolveProviderBindingGuard } from '@/helpers/providerBinding';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useRemoteAgentDeviceGuard } from '@/hooks/useRemoteAgentDeviceGuard';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import ApiModeModelBar from './ApiModeModelBar';
import HeteroPlus from './HeteroPlus';
import ScheduledSendChip from './ScheduledSendChip';
import { shouldShowHeteroModelSelector } from './shouldShowHeteroModelSelector';

// Heterogeneous agents (e.g. Claude Code) bring their own toolchain and memory,
// so most LobeHub-side pickers don't apply — no built-in left action fits, and
// the bar is composed entirely from `extraActionItems`: a hetero-only `+` menu
// (formatting toolbar + "Send later"), then the CLI model + thinking-effort
// selector. Both sit in the input's bottom-left corner, where the agent composer
// puts its `+` and model picker, rather than off in the control-bar strip below.
const leftActions: ActionKeys[] = [];

/**
 * GuardBanner
 *
 * A deliberately thin, single-line warning that sits just above the input. We
 * fold the headline and the hint onto one line (no separate `description`
 * block, no oversized 24px icon) so the guard stays a compact strip instead of
 * eating a chunk of the conversation area.
 */
const GuardBanner = memo<{ action?: ReactNode; hint?: string; title: string }>(
  ({ title, hint, action }) => (
    <WideScreenContainer>
      <Flexbox align={'center'} paddingBlock={'0 8px'} paddingInline={12}>
        <Alert
          action={action}
          style={{ maxWidth: 880, width: '100%' }}
          type={'warning'}
          title={
            <Flexbox horizontal align={'baseline'} gap={6} style={{ flexWrap: 'wrap' }}>
              <span>{title}</span>
              {hint && <span style={{ fontWeight: 400, opacity: 0.75 }}>{hint}</span>}
            </Flexbox>
          }
        />
      </Flexbox>
    </WideScreenContainer>
  ),
);

GuardBanner.displayName = 'GuardBanner';

/**
 * HeterogeneousChatInput
 *
 * Simplified ChatInput for heterogeneous agents (Claude Code, etc.).
 * Keeps only: text input, typo toggle, send button, and a working-directory
 * picker — no model/tools/memory/KB/MCP/runtime-mode/upload.
 *
 * In cloud (web) mode, shows a configuration prompt and disables the input
 * until the user sets up their cloud credentials in agent profile.
 */
const HeterogeneousChatInput = memo(() => {
  const { t } = useTranslation('chat');
  // Scope every hetero check to the conversation's agent. Passing `agentId`
  // into the cloud-credential and device guards keeps them validating the same
  // agent that `agencyConfig`/`isDeviceExecution` are computed from, instead of
  // the global (hijack-prone) active agent.
  const agentId = useConversationStore(contextSelectors.agentId);
  const { isConfigured, goToConfig } = useHeteroAgentCloudConfig(agentId);
  const navigate = useWorkspaceAwareNavigate();

  // Effective config = shared row + this member's per-agent device override
  // — the raw shared `agencyConfig` may carry another member's
  // device pick, which would drive the guard/model-selector gates off the
  // wrong machine.
  // While the preference is loading, the merged config may still reflect only
  // the shared row — hold the input closed (below) instead of gating device
  // runs off a value that can flip once the override arrives.
  const { agencyConfig, isPreferenceLoading, workspaceScoped } = useEffectiveAgencyConfig(agentId);
  const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
  const providerType = heterogeneousProvider?.type;
  const enableAgentProviderBinding = useUserStore(labPreferSelectors.enableAgentProviderBinding);
  const isApiAuth = heterogeneousProvider?.authMode === 'api';
  const serverDefaultApiConfig =
    isApiAuth && heterogeneousProvider.apiConfig?.source === 'server-default'
      ? heterogeneousProvider.apiConfig
      : undefined;
  const providerApiConfig =
    isApiAuth &&
    heterogeneousProvider.apiConfig &&
    heterogeneousProvider.apiConfig.source !== 'server-default'
      ? heterogeneousProvider.apiConfig
      : undefined;
  const apiConfigMissing = isApiAuth && !heterogeneousProvider.apiConfig;
  // The Labs flag gates every API-mode path, server-default included: with the
  // flag off, an api-auth agent behaves exactly as before the feature existed.
  const isApiModeActive =
    enableAgentProviderBinding &&
    (!!serverDefaultApiConfig || apiConfigMissing || !!providerApiConfig);
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    isHetero: !!providerType,
    clientExecutionAvailable: isDesktop,
    workspaceScoped,
  });
  const { error: apiBindingValidationError, isReady: isApiBindingStateReady } =
    useProviderBindingValidation(providerType, providerApiConfig);
  const deviceSelectionRequired =
    !!providerType &&
    !isHeterogeneousSandboxExecutionAvailable(providerType) &&
    executionTarget === 'none';

  const showHeteroModel =
    !isApiAuth &&
    isHeteroSelectorAvailable(providerType) &&
    shouldShowHeteroModelSelector({
      boundDeviceId: agencyConfig?.boundDeviceId,
      executionTarget,
      isDesktopClient: isDesktop,
      providerType,
    });
  const showApiModeModel = !!agentId && isApiModeActive && executionTarget === 'local';
  const apiModeLabDisabled = isApiAuth && !enableAgentProviderBinding;
  const apiModeTargetUnsupported = isApiModeActive && executionTarget !== 'local';
  const validateProviderBinding =
    enableAgentProviderBinding &&
    (apiConfigMissing || !!providerApiConfig) &&
    executionTarget === 'local';
  const { blocked: apiModeBindingBlocked, error: apiModeBindingError } =
    resolveProviderBindingGuard({
      active: validateProviderBinding,
      error: apiBindingValidationError,
      isReady: isApiBindingStateReady,
    });
  // The armed-schedule chip sits immediately after the `+` that armed it, so the
  // state and the control that produced it read as one unit.
  const extraActionItems = useMemo<ChatInputActionsProps['items']>(
    () => [
      { alwaysDisplay: true, children: <HeteroPlus />, key: 'heteroPlus' },
      { alwaysDisplay: true, children: <ScheduledSendChip />, key: 'scheduledSendChip' },
    ],
    [],
  );

  // The model selector rides in the send-area prefix rather than the
  // (left-aligned) action bar, so it sits right next to Send — it qualifies the
  // run the send button is about to commit.
  const sendAreaPrefix = useMemo(
    () =>
      showApiModeModel ? (
        <ApiModeModelBar agentId={agentId} />
      ) : showHeteroModel ? (
        <HeteroModel />
      ) : undefined,
    [agentId, showApiModeModel, showHeteroModel],
  );

  // A run goes to an `lh connect` device when its execution target resolves to a
  // bound device (including desktop "local" opened from web). The
  // bound device must be online before we let the user send — guard it here
  // instead of failing at dispatch time.
  const isDeviceExecution = executionTarget === 'device' && !!agencyConfig?.boundDeviceId;

  const { status, refresh } = useRemoteAgentDeviceGuard({ agentId, enabled: isDeviceExecution });

  const goToAgentProfile = () => {
    if (agentId) navigate(`/agent/${agentId}/profile`);
  };

  const deviceBlocked =
    isDeviceExecution &&
    (status === 'device-offline' || status === 'platform-unavailable' || status === 'no-device');

  const renderDeviceGuard = () => {
    if (!deviceBlocked) return null;

    let title: string;
    let desc: string;

    if (status === 'no-device') {
      title = t('platformAgent.deviceGuard.noDevice.title');
      desc = t('platformAgent.deviceGuard.noDevice.desc');
    } else if (status === 'device-offline') {
      title = t('platformAgent.deviceGuard.deviceOffline.title');
      desc = t('platformAgent.deviceGuard.deviceOffline.desc');
    } else {
      // `platform-unavailable` only arises for remote-typed agents (the guard's
      // capability check), so providerType is always set here — fall back safely.
      const name = (providerType && HETEROGENEOUS_TYPE_LABELS[providerType]) || providerType || '';
      title = t('platformAgent.deviceGuard.platformUnavailable.title', { name });
      desc = t('platformAgent.deviceGuard.platformUnavailable.desc', { name });
    }

    return (
      <GuardBanner
        hint={desc}
        title={title}
        action={
          <Flexbox horizontal gap={4}>
            <Button size={'small'} type={'fill'} onClick={refresh}>
              {t('platformAgent.deviceGuard.refresh')}
            </Button>
            <Button size={'small'} type={'primary'} onClick={goToAgentProfile}>
              {t('platformAgent.deviceGuard.configure')}
            </Button>
          </Flexbox>
        }
      />
    );
  };

  const renderCloudConfigGuard = () => {
    // Until the override loads, `isDeviceExecution` may be a false negative —
    // don't flash the cloud-config prompt for what turns out to be a device run.
    if (
      apiModeLabDisabled ||
      apiModeTargetUnsupported ||
      isPreferenceLoading ||
      deviceSelectionRequired ||
      isDeviceExecution ||
      isConfigured
    ) {
      return null;
    }

    return (
      <GuardBanner
        hint={t('heteroAgent.cloudNotConfigured.desc')}
        title={t('heteroAgent.cloudNotConfigured.title')}
        action={
          <Button size={'small'} type={'primary'} onClick={goToConfig}>
            {t('heteroAgent.cloudNotConfigured.action')}
          </Button>
        }
      />
    );
  };

  const renderApiModeLabGuard = () => {
    if (!apiModeLabDisabled) return null;

    return (
      <GuardBanner
        hint={t('heteroAgent.apiMode.labDisabled.desc')}
        title={t('heteroAgent.apiMode.labDisabled.title')}
        action={
          <Button size={'small'} type={'primary'} onClick={() => navigate('/settings/labs')}>
            {t('heteroAgent.apiMode.labDisabled.action')}
          </Button>
        }
      />
    );
  };

  const renderApiModeTargetGuard = () => {
    if (!apiModeTargetUnsupported) return null;

    return (
      <GuardBanner
        hint={t('heteroAgent.apiMode.localOnly.desc')}
        title={t('heteroAgent.apiMode.localOnly.title')}
        action={
          <Button size={'small'} type={'primary'} onClick={goToAgentProfile}>
            {t('platformAgent.deviceGuard.configure')}
          </Button>
        }
      />
    );
  };

  const renderApiModeBindingGuard = () => {
    if (!apiModeBindingError) return null;

    const title =
      apiModeBindingError.code === 'configMissing'
        ? t('heteroAgent.apiMode.configMissing')
        : apiModeBindingError.code === 'agentUnsupported'
          ? t('heteroAgent.apiMode.agentUnsupported', { name: providerType })
          : t(`heteroAgent.apiMode.${apiModeBindingError.code}`, apiModeBindingError);

    return (
      <GuardBanner
        title={title}
        action={
          <Button size={'small'} type={'primary'} onClick={goToAgentProfile}>
            {t('platformAgent.deviceGuard.configure')}
          </Button>
        }
      />
    );
  };

  const renderDeviceSelectionGuard = () => {
    if (!deviceSelectionRequired) return null;

    return (
      <GuardBanner
        title={t('platformAgent.deviceGuard.noDevice.title')}
        hint={t('heteroAgent.executionTarget.sandboxUnsupported', {
          name: providerType ? HETEROGENEOUS_TYPE_LABELS[providerType] : undefined,
        })}
      />
    );
  };

  // Device execution doesn't use the cloud sandbox, so it doesn't need cloud
  // credentials — only the sandbox path gates on `isConfigured`. While the
  // workspace preference loads, keep send disabled: the effective target isn't
  // known yet, so neither guard can vouch for the run.
  const inputDisabled =
    apiModeLabDisabled ||
    apiModeTargetUnsupported ||
    apiModeBindingBlocked ||
    isPreferenceLoading ||
    deviceSelectionRequired ||
    (!isConfigured && !isDeviceExecution) ||
    deviceBlocked;
  const hasGuard =
    apiModeLabDisabled ||
    apiModeTargetUnsupported ||
    !!apiModeBindingError ||
    deviceSelectionRequired ||
    deviceBlocked ||
    (!isConfigured && !isDeviceExecution);

  return (
    <Flexbox>
      {renderApiModeLabGuard()}
      {renderApiModeTargetGuard()}
      {renderApiModeBindingGuard()}
      {renderDeviceSelectionGuard()}
      {renderCloudConfigGuard()}
      {renderDeviceGuard()}
      <ChatInput
        allowExpand={false}
        controlBarSlot={<HeteroControlBar />}
        extraActionItems={extraActionItems}
        leftActions={leftActions}
        sendAreaPrefix={sendAreaPrefix}
        sendButtonProps={{ disabled: inputDisabled, shape: 'round' }}
        skipScrollMarginWithList={!hasGuard}
        onEditorReady={(instance) => {
          // Sync to global ChatStore for compatibility with other features
          useChatStore.setState({ mainInputEditor: instance });
        }}
      />
    </Flexbox>
  );
});

HeterogeneousChatInput.displayName = 'HeterogeneousChatInput';

export default HeterogeneousChatInput;
