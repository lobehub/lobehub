import { Accordion, AccordionItem } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { type Key, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

interface ThreadExecutionSummaryProps {
  messageId: string;
}

export const getThreadExecutionStepCount = (toolCalls?: number): number =>
  Math.max(1, (toolCalls ?? 0) + 1);

/**
 * Persistent content-level affordance for a projected Agent reply.
 * Reuses the same borderless Accordion chrome as AssistantGroup's ProcessFold,
 * but opening this projection navigates to the associated Isolation Thread.
 */
const ThreadExecutionSummary = memo<ThreadExecutionSummaryProps>(({ messageId }) => {
  const { t } = useTranslation('chat');
  const thread = useChatStore(threadSelectors.getIsolationThreadBySourceMsgId(messageId));
  const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);

  const handleExpandedChange = useCallback(
    (_keys: Key[]) => {
      if (!thread) return;
      openThreadInPortal(thread.id, messageId);
    },
    [messageId, openThreadInPortal, thread],
  );

  if (!thread) return null;

  const label = t('turnProcess.viewFullRecordWithSteps', {
    count: getThreadExecutionStepCount(thread.metadata?.totalToolCalls),
  });

  return (
    <Accordion expandedKeys={[]} variant={'borderless'} onExpandedChange={handleExpandedChange}>
      <AccordionItem
        itemKey={'execution-record'}
        paddingBlock={4}
        paddingInline={4}
        title={<Text type={'secondary'}>{label}</Text>}
      />
    </Accordion>
  );
});

ThreadExecutionSummary.displayName = 'ThreadExecutionSummary';

export default ThreadExecutionSummary;
