'use client';

import { Alert, Flexbox, Highlighter } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquare, Timer, Wrench } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type TaskDetail } from '@/types/index';
import { ThreadStatus } from '@/types/index';

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

/**
 * Extract displayable error content from various error structures
 */
const getErrorContent = (error: Record<string, any> | undefined): string | null => {
  if (!error) return null;

  // Try common error structures
  // 1. error.error.body (TRPC style)
  if (error.error?.body) {
    return JSON.stringify(error.error.body, null, 2);
  }

  // 2. error.body (direct body)
  if (error.body && typeof error.body === 'object') {
    return JSON.stringify(error.body, null, 2);
  }

  // 3. error.message (if it's not "[object Object]")
  if (error.message && typeof error.message === 'string' && error.message !== '[object Object]') {
    return error.message;
  }

  // 4. If error itself is an object with meaningful content, stringify it
  // Skip if it only has a useless message field
  const keys = Object.keys(error);
  if (keys.length > 0) {
    // Filter out useless "[object Object]" values
    const meaningfulEntries = Object.entries(error).filter(([, value]) => {
      if (typeof value === 'string' && value === '[object Object]') return false;
      return true;
    });

    if (meaningfulEntries.length > 0) {
      return JSON.stringify(Object.fromEntries(meaningfulEntries), null, 2);
    }
  }

  return null;
};

const ErrorState = memo<ErrorStateProps>(({ taskDetail }) => {
  const { t } = useTranslation('chat');

  const { status, duration, totalToolCalls, totalMessages, totalCost, error } = taskDetail;

  const isCancelled = status === ThreadStatus.Cancel;

  // Format duration and cost using shared utilities
  const formattedDuration = useMemo(() => formatDuration(duration), [duration]);
  const formattedCost = useMemo(() => formatCost(totalCost), [totalCost]);

  // Extract error content
  const errorContent = useMemo(() => getErrorContent(error), [error]);

  const hasMetrics = !!(formattedDuration || totalToolCalls || totalMessages || formattedCost);

  return (
    <Flexbox gap={12}>
      {/* Error Content */}
      <Alert
        title={isCancelled ? t('task.status.cancelled') : t('task.status.failed')}
        type={'secondary'}
        extra={
          errorContent && (
            <Highlighter
              actionIconSize={'small'}
              language={'json'}
              padding={8}
              variant={'borderless'}
            >
              {errorContent}
            </Highlighter>
          )
        }
      />
      {hasMetrics ? (
        <Flexbox horizontal align="center" gap={12} wrap="wrap">
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
