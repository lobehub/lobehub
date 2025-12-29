'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CircleX, MessageSquare, Timer, Wrench } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type TaskDetail, ThreadStatus } from '@/types/index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 12px;
    padding-inline: 16px;
  `,
  errorMessage: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorErrorText};
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  metricItem: css`
    display: flex;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  metricValue: css`
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
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
  statusRow: css`
    font-size: 13px;
  `,
  statusText: css`
    font-weight: 500;
    color: ${cssVar.colorErrorText};
  `,
}));

interface ErrorStateProps {
  taskDetail: TaskDetail;
}

const ErrorState = memo<ErrorStateProps>(({ taskDetail }) => {
  const { t } = useTranslation('chat');

  const { status, duration, totalToolCalls, totalMessages, totalCost, error } = taskDetail;

  const isCancelled = status === ThreadStatus.Cancel;

  // Format duration
  const formattedDuration = useMemo(() => {
    if (!duration) return null;
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60_000) return `${(duration / 1000).toFixed(1)}s`;
    const minutes = Math.floor(duration / 60_000);
    const seconds = ((duration % 60_000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }, [duration]);

  // Format cost
  const formattedCost = useMemo(() => {
    if (!totalCost) return null;
    if (totalCost < 0.01) return `$${totalCost.toFixed(4)}`;
    return `$${totalCost.toFixed(2)}`;
  }, [totalCost]);

  const hasMetrics = formattedDuration || totalToolCalls || totalMessages || formattedCost;

  return (
    <Flexbox>
      {/* Error Content */}
      <Flexbox className={styles.container} gap={8}>
        <Flexbox align="center" className={styles.statusRow} gap={8} horizontal>
          <div className={styles.statusIcon}>
            <CircleX size={10} />
          </div>
          <span className={styles.statusText}>
            {isCancelled
              ? t('task.status.cancelled', { defaultValue: 'Cancelled' })
              : t('task.status.failed', { defaultValue: 'Failed' })}
          </span>
        </Flexbox>

        {error && <span className={styles.errorMessage}>{error}</span>}
      </Flexbox>

      {/* Footer with metrics */}
      {hasMetrics && (
        <Flexbox align="center" className={styles.footer} gap={12} horizontal wrap="wrap">
          {/* Duration */}
          {formattedDuration && (
            <div className={styles.metricItem}>
              <Timer size={12} />
              <span className={styles.metricValue}>{formattedDuration}</span>
            </div>
          )}

          {/* Tool Calls */}
          {totalToolCalls !== undefined && totalToolCalls > 0 && (
            <>
              <div className={styles.separator} />
              <div className={styles.metricItem}>
                <Wrench size={12} />
                <span className={styles.metricValue}>{totalToolCalls}</span>
                <span>{t('task.metrics.toolCallsShort', { defaultValue: 'tools' })}</span>
              </div>
            </>
          )}

          {/* Messages */}
          {totalMessages !== undefined && totalMessages > 0 && (
            <>
              <div className={styles.separator} />
              <div className={styles.metricItem}>
                <MessageSquare size={12} />
                <span className={styles.metricValue}>{totalMessages}</span>
                <span>{t('task.metrics.messagesShort', { defaultValue: 'messages' })}</span>
              </div>
            </>
          )}

          {/* Cost */}
          {formattedCost && (
            <>
              <div className={styles.separator} />
              <div className={styles.metricItem}>
                <span className={styles.metricValue}>{formattedCost}</span>
              </div>
            </>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

ErrorState.displayName = 'ErrorState';

export default ErrorState;
