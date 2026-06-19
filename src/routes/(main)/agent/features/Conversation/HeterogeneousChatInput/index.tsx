'use client';

import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { Alert, Button, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import urlJoin from 'url-join';

import { useHeteroAgentCloudConfig } from '@/business/client/hooks/useHeteroAgentCloudConfig';
import { isDesktop } from '@/const/version';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import WideScreenContainer from '@/features/WideScreenContainer';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useRemoteAgentDeviceGuard } from '@/hooks/useRemoteAgentDeviceGuard';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import HeteroControlBar from './HeteroControlBar';

// Heterogeneous agents (e.g. Claude Code) bring their own toolchain, memory,
// and model, so LobeHub-side pickers don't apply. Typo is kept so the user
// can still toggle the rich-text formatting bar.
const leftActions: ActionKeys[] = ['typo'];
const rightActions: ActionKeys[] = [];

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
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    isHetero: !!providerType,
    clientExecutionAvailable: isDesktop,
  });
  const isRemoteAgent = !!providerType && isRemoteHeterogeneousType(providerType);

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
      <WideScreenContainer>
        <Flexbox align={'center'} paddingBlock={'0 8px'} paddingInline={12}>
          <Alert
            description={desc}
            style={{ maxWidth: 880, width: '100%' }}
            title={title}
            type={'warning'}
            action={
              <Flexbox horizontal gap={6}>
                <Button size={'small'} onClick={refresh}>
                  {t('platformAgent.deviceGuard.refresh')}
                </Button>
                <Button size={'small'} type={'primary'} onClick={goToAgentProfile}>
                  {t('platformAgent.deviceGuard.configure')}
                </Button>
              </Flexbox>
            }
          />
        </Flexbox>
      </WideScreenContainer>
    );
  };

  const renderCloudConfigGuard = () => {
    if (isDeviceExecution || isConfigured) return null;

    return (
      <WideScreenContainer>
        <Flexbox align={'center'} paddingBlock={'0 8px'} paddingInline={12}>
          <Alert
            description={t('heteroAgent.cloudNotConfigured.desc')}
            style={{ maxWidth: 880, width: '100%' }}
            title={t('heteroAgent.cloudNotConfigured.title')}
            type={'warning'}
            action={
              <Button size={'small'} type={'primary'} onClick={goToConfig}>
                {t('heteroAgent.cloudNotConfigured.action')}
              </Button>
            }
          />
        </Flexbox>
      </WideScreenContainer>
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
        controlBarSlot={<HeteroControlBar />}
        leftActions={leftActions}
        rightActions={rightActions}
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
