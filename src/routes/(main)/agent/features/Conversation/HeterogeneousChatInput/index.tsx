'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHeteroAgentCloudConfig } from '@/business/client/hooks/useHeteroAgentCloudConfig';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
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

  return (
    <Flexbox>
      {!isConfigured && (
        <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
          <Alert
            type={'warning'}
            title={t('heteroAgent.cloudNotConfigured.title')}
            description={
              <Flexbox horizontal align={'center'} justify={'space-between'} gap={8}>
                <span>{t('heteroAgent.cloudNotConfigured.desc')}</span>
                <Button size={'small'} type={'primary'} onClick={goToConfig}>
                  {t('heteroAgent.cloudNotConfigured.action')}
                </Button>
              </Flexbox>
            }
          />
        </Flexbox>
      )}
      <ChatInput
        skipScrollMarginWithList
        leftActions={leftActions}
        rightActions={rightActions}
        runtimeConfigSlot={<WorkingDirectoryBar />}
        sendButtonProps={{ disabled: !isConfigured, shape: 'round' }}
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
