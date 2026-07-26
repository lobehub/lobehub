import { ThreadStatus } from '@lobechat/types';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, ListChecks } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

interface ThreadExecutionSummaryProps {
  messageId: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    align-self: flex-start;

    width: fit-content;
    height: 24px;
    padding-inline: 4px;

    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: transparent;
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

  const toolCalls = thread.metadata?.totalToolCalls;
  const stepCount =
    typeof toolCalls === 'number'
      ? Math.max(1, toolCalls + 1)
      : thread.status === ThreadStatus.Completed
        ? 1
        : undefined;
  const label = stepCount
    ? t('turnProcess.done', { count: stepCount })
    : t('workflow.working', { defaultValue: 'Working...' });

  return (
    <Button
      aria-label={label}
      className={styles.button}
      icon={ListChecks}
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
