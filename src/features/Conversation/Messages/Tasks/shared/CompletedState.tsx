'use client';

import { type TaskDetail } from '@lobechat/types';
import { type IconProps } from '@lobehub/ui';
import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Footprints, Timer, Wrench } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Markdown from '../../../Markdown';
import { formatCost, formatDuration } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapseContent: css`
    padding-block: 8px;
    padding-inline: 0;
    font-size: 13px;
    line-height: 1.6;
  `,
  separator: css`
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: ${cssVar.colorTextQuaternary};
  `,
}));

export type CompletedStateVariant = 'detail' | 'compact';

interface CompletedStateProps {
  content?: string;
  expanded?: boolean;
  taskDetail: TaskDetail;
  variant?: CompletedStateVariant;
}

interface MetricItemProps {
  icon?: IconProps['icon'];
  label?: string;
  value: string | number;
}

export const MetricItem = memo<MetricItemProps>(({ icon, label, value }) => (
  <Tag
    icon={<Icon icon={icon} />}
    style={{ color: cssVar.colorTextDescription, padding: 0 }}
    variant={'borderless'}
  >
    {value}
    {label}
  </Tag>
));

MetricItem.displayName = 'MetricItem';

interface MetricsRowProps {
  formattedCost?: string | null;
  formattedDuration?: string | null;
  totalSteps?: number;
  totalToolCalls?: number;
  variant: CompletedStateVariant;
}

const MetricsRow = memo<MetricsRowProps>(
  ({ formattedDuration, formattedCost, totalSteps, totalToolCalls, variant }) => {
    const { t } = useTranslation('chat');

    const metrics: Array<{ icon?: IconProps['icon']; label?: string; value: string | number }> = [];

    // Build metrics array in order
    if (totalSteps !== undefined && totalSteps > 0) {
      metrics.push({
        icon: Footprints,
        label: t('task.metrics.stepsShort'),
        value: totalSteps,
      });
    }

    if (totalToolCalls !== undefined && totalToolCalls > 0) {
      metrics.push({
        icon: Wrench,
        label: t('task.metrics.toolCallsShort'),
        value: totalToolCalls,
      });
    }

    if (formattedCost) {
      metrics.push({
        icon: undefined,
        value: formattedCost,
      });
    }

    if (variant === 'detail') {
      return (
        <Flexbox horizontal align="center" gap={12} justify="space-between" paddingBlock={'8px 0'}>
          {/* Left: Duration */}
          <Flexbox horizontal align="center" gap={12}>
            {formattedDuration && <MetricItem icon={Timer} value={formattedDuration} />}
          </Flexbox>

          {/* Right: Steps, Tool Calls, Cost */}
          <Flexbox horizontal align="center" gap={12}>
            {metrics.map((metric, index) => (
              <MetricItem
                icon={metric.icon}
                key={index}
                label={metric.label}
                value={metric.value}
              />
            ))}
          </Flexbox>
        </Flexbox>
      );
    }

    // Compact variant
    return (
      <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
        {/* Left: Duration */}
        <Flexbox horizontal align="center" gap={8}>
          {formattedDuration && <MetricItem icon={Timer} value={formattedDuration} />}
        </Flexbox>

        {/* Right: Steps, Tool Calls, Cost */}
        <Flexbox horizontal align="center" gap={12}>
          {metrics.map((metric, index) => (
            <Flexbox horizontal align="center" gap={12} key={index}>
              {index > 0 && <div className={styles.separator} />}
              <MetricItem icon={metric.icon} label={metric.label} value={metric.value} />
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    );
  },
);

MetricsRow.displayName = 'MetricsRow';

const CompletedState = memo<CompletedStateProps>(
  ({ taskDetail, content, expanded = false, variant = 'detail' }) => {
    const { duration, totalToolCalls, totalSteps, totalCost } = taskDetail;

    // Format duration and cost using shared utilities
    const formattedDuration = useMemo(() => formatDuration(duration), [duration]);
    const formattedCost = useMemo(() => formatCost(totalCost), [totalCost]);

    const hasContent = content && content.trim().length > 0;
    const hasMetrics =
      formattedDuration ||
      (totalSteps !== undefined && totalSteps > 0) ||
      (totalToolCalls !== undefined && totalToolCalls > 0) ||
      formattedCost;

    // Detail variant: content first, then footer with metrics
    if (variant === 'detail') {
      return (
        <>
          {content && <Markdown>{content}</Markdown>}
          {hasMetrics && (
            <MetricsRow
              formattedCost={formattedCost ?? undefined}
              formattedDuration={formattedDuration ?? undefined}
              totalSteps={totalSteps}
              totalToolCalls={totalToolCalls}
              variant={variant}
            />
          )}
        </>
      );
    }

    // Compact variant: metrics first, then expandable content
    return (
      <>
        {hasContent && expanded && (
          <div className={styles.collapseContent}>
            <Markdown>{content}</Markdown>
          </div>
        )}
        {hasMetrics && (
          <MetricsRow
            formattedCost={formattedCost ?? undefined}
            formattedDuration={formattedDuration ?? undefined}
            totalSteps={totalSteps}
            totalToolCalls={totalToolCalls}
            variant={variant}
          />
        )}
      </>
    );
  },
);

CompletedState.displayName = 'CompletedState';

export default CompletedState;
