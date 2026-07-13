'use client';

import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { Alert, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import urlJoin from 'url-join';

import { useHeteroAgentCloudConfig } from '@/business/client/hooks/useHeteroAgentCloudConfig';
import { isDesktop } from '@/const/version';
import { type ActionKeys } from '@/features/ChatInput';
import HeteroModel from '@/features/ChatInput/ControlBar/HeteroModel';
import { ChatInput } from '@/features/Conversation';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import WideScreenContainer from '@/features/WideScreenContainer';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useRemoteAgentDeviceGuard } from '@/hooks/useRemoteAgentDeviceGuard';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import HeteroControlBar from './HeteroControlBar';
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
const GuardBanner = memo<{ action: ReactNode; hint?: string; title: string }>(
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
  const params = useParams<{ aid: string }>();
  const navigate = useNavigate();

  const agencyConfig = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig,
  );
  const providerType = agencyConfig?.heterogeneousProvider?.type;
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(agentId));
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    isHetero: !!providerType,
    clientExecutionAvailable: isDesktop,
    workspaceScoped: isWorkspaceAgent,
  });
  const isRemoteAgent = !!providerType && isRemoteHeterogeneousType(providerType);

  // The model + thinking-effort selector only applies to local-CLI providers
  // (claude-code / codex) and only when this surface actually dispatches the run.
  // Gating here (rather than letting HeteroModel self-hide) keeps the action bar
  // from rendering an empty slot. Uses the raw `executionTarget` to mirror the
  // gate the control bar applied before the selector moved into the input.
  const isSelectableHeteroProvider = providerType === 'claude-code' || providerType === 'codex';
  const showHeteroModel =
    isSelectableHeteroProvider &&
    shouldShowHeteroModelSelector({
      boundDeviceId: agencyConfig?.boundDeviceId,
      executionTarget: agencyConfig?.executionTarget,
      isDesktopClient: isDesktop,
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
    () => (showHeteroModel ? <HeteroModel /> : undefined),
    [showHeteroModel],
  );

  // A run goes to an `lh connect` device when the provider is a remote-only type
  // (openclaw / hermes) OR a local-CLI type (claude-code / codex) resolves to a
  // bound device (including desktop "local" opened from web). Either way the
  // bound device must be online before we let the user send — guard it here
  // instead of failing at dispatch time.
  const isDeviceExecution =
    isRemoteAgent || (executionTarget === 'device' && !!agencyConfig?.boundDeviceId);

  const { status, refresh } = useRemoteAgentDeviceGuard({ agentId, enabled: isDeviceExecution });

  const goToAgentProfile = () => {
    if (params.aid) navigate(urlJoin('/agent', params.aid, 'profile'));
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
    if (isDeviceExecution || isConfigured) return null;

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

  // Device execution doesn't use the cloud sandbox, so it doesn't need cloud
  // credentials — only the sandbox path gates on `isConfigured`.
  const inputDisabled = (!isConfigured && !isDeviceExecution) || deviceBlocked;
  const hasGuard = deviceBlocked || (!isConfigured && !isDeviceExecution);

  return (
    <Flexbox>
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
