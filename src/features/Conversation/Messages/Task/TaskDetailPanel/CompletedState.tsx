'use client';

import { Flexbox, Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Check, Footprints, Timer, Wrench } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type TaskDetail } from '@/types/index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    padding-block: 12px;
    padding-inline: 16px;
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

    color: ${cssVar.colorSuccessText};

    background: ${cssVar.colorSuccessBg};
  `,
}));

interface CompletedStateProps {
  content?: string;
  taskDetail: TaskDetail;
}

const CompletedState = memo<CompletedStateProps>(({ taskDetail, content }) => {
  const { t } = useTranslation('chat');

  const { duration, totalToolCalls, totalSteps, totalCost } = taskDetail;

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

  const hasMetrics = formattedDuration || totalSteps || totalToolCalls || formattedCost;

  return (
    <Flexbox>
      {/* Content */}
      {content && (
        <div className={styles.content}>
          <Markdown>{content}</Markdown>
        </div>
      )}

      {/* Footer with metrics */}
      {hasMetrics && (
        <Flexbox
          align="center"
          className={styles.footer}
          gap={12}
          horizontal
          justify={'space-between'}
          wrap="wrap"
        >
          <Flexbox align="center" gap={12} horizontal>
            {/* Status Icon */}
            <div className={styles.statusIcon}>
              <Check size={10} strokeWidth={3} />
            </div>
            {/* Duration */}
            {formattedDuration && (
              <div className={styles.metricItem}>
                <Timer size={12} />
                <span className={styles.metricValue}>{formattedDuration}</span>
              </div>
            )}
          </Flexbox>
          <Flexbox align="center" gap={12} horizontal>
            {/* Steps */}
            {totalSteps !== undefined && totalSteps > 0 && (
              <div className={styles.metricItem}>
                <Footprints size={12} />
                <span className={styles.metricValue}>{totalSteps}</span>
                <span>{t('task.metrics.stepsShort')}</span>
              </div>
            )}
            {/* Tool Calls */}
            {totalToolCalls !== undefined && totalToolCalls > 0 && (
              <>
                <div className={styles.separator} />
                <div className={styles.metricItem}>
                  <Wrench size={12} />
                  <span className={styles.metricValue}>{totalToolCalls}</span>
                  <span>{t('task.metrics.toolCallsShort')}</span>
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
        </Flexbox>
      )}
    </Flexbox>
  );
});

CompletedState.displayName = 'CompletedState';

export default CompletedState;
