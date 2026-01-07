'use client';

import { Alert, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquare, Timer, Wrench } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type TaskDetail, ThreadStatus } from '@/types/index';

import { MetricItem } from './CompletedState';
import { formatCost, formatDuration } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  separator: css`
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: ${cssVar.colorTextQuaternary};
  `,
  statusIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
    border-radius: 50%;

    color: ${cssVar.colorErrorText};

    background: ${cssVar.colorErrorBg};
  `,
}));

interface ErrorStateProps {
  taskDetail: TaskDetail;
}

const ErrorState = memo<ErrorStateProps>(({ taskDetail }) => {
  const { t } = useTranslation('chat');

  const { status, duration, totalToolCalls, totalMessages, totalCost, error } = taskDetail;

  const isCancelled = status === ThreadStatus.Cancel;

  // Format duration and cost using shared utilities
  const formattedDuration = useMemo(() => formatDuration(duration), [duration]);
  const formattedCost = useMemo(() => formatCost(totalCost), [totalCost]);

  const hasMetrics = !!(formattedDuration || totalToolCalls || totalMessages || formattedCost);

  return (
    <Flexbox gap={12}>
      {/* Error Content */}
      <Alert
        extra={
          error?.error?.body && (
            <Highlighter
              actionIconSize={'small'}
              language={'json'}
              padding={8}
              variant={'borderless'}
            >
              {JSON.stringify(error?.error?.body, null, 2)}
            </Highlighter>
          )
        }
        title={isCancelled ? t('task.status.cancelled') : t('task.status.failed')}
        type={'secondary'}
      />
      {hasMetrics ? (
        <Flexbox align="center" gap={12} horizontal wrap="wrap">
          {/* Duration */}
          {formattedDuration && <MetricItem icon={Timer} value={formattedDuration} />}

          {/* Tool Calls */}
          {totalToolCalls !== undefined && totalToolCalls > 0 && (
            <>
              <div className={styles.separator} />
              <MetricItem
                icon={Wrench}
                label={t('task.metrics.toolCallsShort', { defaultValue: 'tools' })}
                value={totalToolCalls}
              />
            </>
          )}

          {/* Messages */}
          {totalMessages !== undefined && totalMessages > 0 && (
            <>
              <div className={styles.separator} />
              <MetricItem
                icon={MessageSquare}
                label={t('task.metrics.messagesShort', { defaultValue: 'messages' })}
                value={totalMessages}
              />
            </>
          )}

          {/* Cost */}
          {formattedCost && (
            <>
              <div className={styles.separator} />
              <MetricItem value={formattedCost} />
            </>
          )}
        </Flexbox>
      ) : null}
    </Flexbox>
  );
});

ErrorState.displayName = 'ErrorState';

export default ErrorState;
