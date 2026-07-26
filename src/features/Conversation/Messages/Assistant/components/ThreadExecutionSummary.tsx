import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightOpen } from 'lucide-react';
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
    padding-inline: 0;

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
  const { t } = useTranslation('common');
  const thread = useChatStore(threadSelectors.getIsolationThreadBySourceMsgId(messageId));
  const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);

  const handleClick = useCallback(() => {
    if (!thread) return;
    openThreadInPortal(thread.id, messageId);
  }, [messageId, openThreadInPortal, thread]);

  if (!thread) return null;

  return (
    <Button
      aria-label={t('viewExecutionDetails')}
      className={styles.button}
      icon={PanelRightOpen}
      size={'small'}
      type={'text'}
      onClick={handleClick}
    >
      {t('viewExecutionDetails')}
    </Button>
  );
});

ThreadExecutionSummary.displayName = 'ThreadExecutionSummary';

export default ThreadExecutionSummary;
