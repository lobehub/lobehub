import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

interface ThreadExecutionSummaryProps {
  messageId: string;
}

export const getThreadExecutionStepCount = (toolCalls?: number): number =>
  Math.max(1, (toolCalls ?? 0) + 1);

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    align-self: flex-start;

    width: fit-content;
    height: 24px;
    padding-inline: 8px 4px;

    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorFillTertiary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

/**
 * Persistent content-level affordance for a projected Agent reply.
 * Execution details belong to the reply narrative, not its transient action bar.
 */
const ThreadExecutionSummary = memo<ThreadExecutionSummaryProps>(({ messageId }) => {
  const { t } = useTranslation('chat');
  const thread = useChatStore(threadSelectors.getIsolationThreadBySourceMsgId(messageId));
  const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);

  const handleClick = useCallback(() => {
    if (!thread) return;
    openThreadInPortal(thread.id, messageId);
  }, [messageId, openThreadInPortal, thread]);

  if (!thread) return null;

  const label = t('turnProcess.executed', {
    count: getThreadExecutionStepCount(thread.metadata?.totalToolCalls),
  });

  return (
    <Button
      aria-label={label}
      className={styles.button}
      size={'small'}
      type={'text'}
      onClick={handleClick}
    >
      {label}
      <ChevronRight size={14} />
    </Button>
  );
});

ThreadExecutionSummary.displayName = 'ThreadExecutionSummary';

export default ThreadExecutionSummary;
