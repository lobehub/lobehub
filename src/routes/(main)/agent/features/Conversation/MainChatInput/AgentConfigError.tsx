'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  // base-ui stacks title and description in a gapless column, and both use a
  // 20px line height — without this they read as one run-on paragraph.
  description: css`
    margin-block-start: 2px;
  `,
  // The action column is top-aligned by default, which strands the button in
  // the corner as soon as the diagnosis wraps. Centre it against the whole
  // block, and keep a gutter so wrapped text never runs up against it.
  retry: css`
    align-self: center;
    padding-inline-start: 12px;
  `,
}));

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
          classNames={{ action: styles.retry, description: styles.description }}
          description={errorMessage}
          title={t('agentConfigError.title')}
          type={'error'}
          action={
            <Button size={'small'} onClick={() => retryAgentConfigFetch(agentId)}>
              {t('agentConfigError.retry')}
            </Button>
          }
        />
      </Flexbox>
    </WideScreenContainer>
  );
});

AgentConfigError.displayName = 'AgentConfigError';

export default AgentConfigError;
