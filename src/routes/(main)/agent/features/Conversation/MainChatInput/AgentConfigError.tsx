'use client';

import { Alert, Button } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/**
 * Surfaces an agent-config fetch failure above the chat input with a retry
 * button. Only shown when the config is still missing (`isAgentConfigLoading`)
 * — a failed background revalidation over cached data stays silent.
 */
const AgentConfigError = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useConversationStore(contextSelectors.agentId);
  const errorMessage = useAgentStore(agentByIdSelectors.getAgentConfigErrorById(agentId));
  const isConfigMissing = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const retryAgentConfigFetch = useAgentStore((s) => s.retryAgentConfigFetch);

  if (!errorMessage || !isConfigMissing) return null;

  return (
    <Alert
      showIcon
      description={errorMessage}
      message={t('agentConfigError.title')}
      style={{ marginBlockEnd: 8 }}
      type={'error'}
      action={
        <Button size={'small'} onClick={() => retryAgentConfigFetch(agentId)}>
          {t('agentConfigError.retry')}
        </Button>
      }
    />
  );
});

AgentConfigError.displayName = 'AgentConfigError';

export default AgentConfigError;
