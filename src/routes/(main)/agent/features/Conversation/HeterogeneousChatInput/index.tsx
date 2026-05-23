'use client';

import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { Alert, Button, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import urlJoin from 'url-join';

import { useHeteroAgentCloudConfig } from '@/business/client/hooks/useHeteroAgentCloudConfig';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useRemoteAgentDeviceGuard } from '@/hooks/useRemoteAgentDeviceGuard';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import WorkingDirectoryBar from './WorkingDirectoryBar';

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
  const { isConfigured, goToConfig } = useHeteroAgentCloudConfig();
  const params = useParams<{ aid: string }>();
  const navigate = useNavigate();

  const providerType = useAgentStore(agentSelectors.currentAgentHeterogeneousProviderType);
  const isRemoteAgent = !!providerType && isRemoteHeterogeneousType(providerType);

  const { status, refresh } = useRemoteAgentDeviceGuard({ enabled: isRemoteAgent });

  const goToAgentProfile = () => {
    if (params.aid) navigate(urlJoin('/agent', params.aid, 'profile'));
  };

  const deviceBlocked =
    isRemoteAgent &&
    (status === 'device-offline' || status === 'platform-unavailable' || status === 'no-device');

  const renderDeviceGuard = () => {
    if (!isRemoteAgent || !deviceBlocked) return null;

    let title: string;
    let desc: string;

    if (status === 'no-device') {
      title = t('platformAgent.deviceGuard.noDevice.title');
      desc = t('platformAgent.deviceGuard.noDevice.desc');
    } else if (status === 'device-offline') {
      title = t('platformAgent.deviceGuard.deviceOffline.title');
      desc = t('platformAgent.deviceGuard.deviceOffline.desc');
    } else {
      const name = HETEROGENEOUS_TYPE_LABELS[providerType] ?? providerType;
      title = t('platformAgent.deviceGuard.platformUnavailable.title', { name });
      desc = t('platformAgent.deviceGuard.platformUnavailable.desc', { name });
    }

    return (
      <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
        <Alert
          title={title}
          type={'warning'}
          description={
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <span>{desc}</span>
              <Flexbox horizontal gap={6}>
                <Button size={'small'} onClick={refresh}>
                  {t('platformAgent.deviceGuard.refresh')}
                </Button>
                <Button size={'small'} type={'primary'} onClick={goToAgentProfile}>
                  {t('platformAgent.deviceGuard.configure')}
                </Button>
              </Flexbox>
            </Flexbox>
          }
        />
      </Flexbox>
    );
  };

  const inputDisabled = (!isConfigured && !isRemoteAgent) || deviceBlocked;

  return (
    <Flexbox>
      {!isRemoteAgent && !isConfigured && (
        <WideScreenContainer>
          <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
            <Alert
              title={t('heteroAgent.cloudNotConfigured.title')}
              type={'warning'}
              description={
                <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                  <span>{t('heteroAgent.cloudNotConfigured.desc')}</span>
                  <Button size={'small'} type={'primary'} onClick={goToConfig}>
                    {t('heteroAgent.cloudNotConfigured.action')}
                  </Button>
                </Flexbox>
              }
            />
          </Flexbox>
        </WideScreenContainer>
      )}
      {renderDeviceGuard()}
      <ChatInput
        skipScrollMarginWithList
        leftActions={leftActions}
        rightActions={rightActions}
        runtimeConfigSlot={<WorkingDirectoryBar />}
        sendButtonProps={{ disabled: inputDisabled, shape: 'round' }}
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
