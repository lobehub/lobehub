'use client';

import { Flexbox, Popover, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  value: css`
    font-size: 12px;
  `,
}));

/** Cost is fractions of a cent per round — two decimals would read as "$0.00". */
export const formatRoundCost = (cost: number): string =>
  cost > 0 && cost < 0.01 ? `<$0.01` : `$${cost.toFixed(cost < 1 ? 3 : 2)}`;

export const formatTokens = (tokens: number): string =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

interface GoalRoundPopoverProps {
  children: ReactNode;
  duration: string;
  index: number;
  status?: string | null;
  usage?: { cost: number; tokens: number } | null;
  verdict?: string | null;
}

/**
 * The audit view of one round.
 *
 * A block on the rail can only encode "how long" through its width; what it
 * cost and how it was judged are exactly what an audit needs and exactly what
 * a bar cannot say. Hover carries them without adding a second row of chrome
 * to a component whose whole point is compactness.
 */
const GoalRoundPopover = memo<GoalRoundPopoverProps>(
  ({ children, duration, index, status, usage, verdict }) => {
    const { t } = useTranslation('chat');

    const verdictLabel = (() => {
      if (verdict === 'passed' || status === 'passed') return t('taskDetail.runVerify.passed');
      if (verdict === 'failed' || status === 'failed') return t('taskDetail.runVerify.failed');
      if (status === 'errored') return t('taskDetail.runVerify.errored');
      if (status === 'running' || status === 'verifying') return t('taskDetail.runVerify.running');
      if (status) return t('taskDetail.runVerify.pending');
      return undefined;
    })();

    const rows: { label: string; value: string }[] = [
      { label: t('taskDetail.goalTimeline.hover.duration'), value: duration },
      // A verdict is the report's own word; `status` is the run's. Both are
      // enum-ish and neither is user-facing copy, so map them rather than
      // leaking a raw `passed` into a Chinese UI.
      ...(verdictLabel
        ? [{ label: t('taskDetail.goalTimeline.hover.verdict'), value: verdictLabel }]
        : []),
      // Absent for a round that never reported usage (still running, or an
      // older row) — an audit should see nothing rather than a fabricated 0.
      ...(usage?.cost
        ? [
            {
              label: t('taskDetail.goalTimeline.hover.cost'),
              value: formatRoundCost(usage.cost),
            },
          ]
        : []),
      ...(usage?.tokens
        ? [
            {
              label: t('taskDetail.goalTimeline.hover.tokens'),
              value: formatTokens(usage.tokens),
            },
          ]
        : []),
    ];

    return (
      <Popover
        arrow={false}
        placement={'top'}
        trigger={'hover'}
        content={
          <Flexbox gap={6} style={{ minWidth: 140 }}>
            <Text fontSize={13} weight={500}>
              {t('taskDetail.goalTimeline.round', { index })}
            </Text>
            {rows.map((row) => (
              <Flexbox
                horizontal
                align={'center'}
                gap={16}
                justify={'space-between'}
                key={row.label}
              >
                <span className={styles.label}>{row.label}</span>
                <span className={styles.value}>{row.value}</span>
              </Flexbox>
            ))}
          </Flexbox>
        }
      >
        {children}
      </Popover>
    );
  },
);

GoalRoundPopover.displayName = 'GoalRoundPopover';

export default GoalRoundPopover;
