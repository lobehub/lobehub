import { Accordion, Text } from '@lobehub/ui/base-ui';
import { memo, useCallback } from 'react';
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

  const handleValueChange = useCallback(
    (_value: string[]) => {
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
    <Accordion
      items={[{ key: 'execution-record', title: <Text type={'secondary'}>{label}</Text> }]}
      styles={{ trigger: { paddingBlock: 4, paddingInline: 4 } }}
      value={[]}
      variant={'borderless'}
      onValueChange={handleValueChange}
    />
  );
});

ThreadExecutionSummary.displayName = 'ThreadExecutionSummary';

export default ThreadExecutionSummary;
