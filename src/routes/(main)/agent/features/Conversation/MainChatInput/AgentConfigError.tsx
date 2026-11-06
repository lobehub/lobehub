'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const styles = stylex.create({
  description: { marginBlockStart: '2px' },
  retry: { alignSelf: 'center', paddingInlineStart: '12px' },
});

/**
 * Surfaces an agent-config fetch failure above the chat input with a retry
 * button. Only shown when the config is still missing (`isAgentConfigLoading`)
 * — a failed background revalidation over cached data stays silent.
 *
 * Wrapped in the composer's own `WideScreenContainer` so its edges land on the
 * input's edges — without it the alert is a plain sibling of `ChatInput` and
 * spills wider than the input on both sides. No extra inline padding: the
 * container's 16px is what the composer itself sits on. The bottom padding
 * absorbs the `skipScrollMarginWithList` -12px pull `MainChatInput` puts on the
 * composer, leaving the ~6px gap the other composer notices have.
 */
const AgentConfigError = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useConversationStore(contextSelectors.agentId);
  const errorMessage = useAgentStore(agentByIdSelectors.getAgentConfigErrorById(agentId));
  const isConfigMissing = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const retryAgentConfigFetch = useAgentStore((s) => s.retryAgentConfigFetch);

  if (!errorMessage || !isConfigMissing) return null;

  return (
    <WideScreenContainer>
      <Flexbox paddingBlock={'0 18px'}>
        <Alert
          showIcon
          description={errorMessage}
          title={t('agentConfigError.title')}
          type={'error'}
          action={
            <Button size={'small'} onClick={() => retryAgentConfigFetch(agentId)}>
              {t('agentConfigError.retry')}
            </Button>
          }
          classNames={{
            action: stylex.props(styles.retry).className,
            description: stylex.props(styles.description).className,
          }}
        />
      </Flexbox>
    </WideScreenContainer>
  );
});

AgentConfigError.displayName = 'AgentConfigError';

export default AgentConfigError;
