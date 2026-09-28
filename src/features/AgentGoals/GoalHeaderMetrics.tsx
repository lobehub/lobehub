'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';
import { useChatStore } from '@/store/chat';
import { type GoalMetricKind } from '@/store/chat/slices/portal/initialState';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { formatSpan, formatUsd, goalStatusKey, summarizeGoalBudget } from './goalPresentation';
import GoalStatusGlyph from './GoalStatusGlyph';

/**
 * The goal's header metrics row — status, tasks, findings, spend, runtime and
 * last activity. Every metric is a drill-down entry into the Portal's metric
 * view. Reads the graph snapshot itself, so any host that has fetched the goal
 * graph (the goal page, the conversation portal) can mount it by id.
 */

const styles = createStaticStyles(({ css }) => ({
  metric: css`
    cursor: pointer;

    min-width: 112px;
    padding-block: 4px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  metrics: css`
    /* Negative inline offset keeps the metric text aligned with the title while
       the hover background still gets breathing room. */
    margin-inline-start: -10px;
  `,
}));

const Metric = memo<{
  label: string;
  onClick: () => void;
  value: ReactNode;
}>(({ label, onClick, value }) => (
  <Flexbox className={styles.metric} gap={2} onClick={onClick}>
    <Flexbox horizontal align={'center'} gap={7} style={{ minHeight: 26 }}>
      {value}
    </Flexbox>
    <Text fontSize={12} type={'secondary'}>
      {label}
    </Text>
  </Flexbox>
));

Metric.displayName = 'GoalHeaderMetric';

/** Relative "last activity" readout; isolated so its refresh never re-renders the row.
 *  Plain text on purpose: the status control already carries the "running"
 *  animation, and a second spinner here said the same thing twice. */
const LivenessValue = memo<{ latest?: Date }>(({ latest }) => {
  const { text } = useActivityTime(latest);
  return (
    <Text fontSize={16} weight={600}>
      {text || '—'}
    </Text>
  );
});

LivenessValue.displayName = 'GoalLivenessValue';

const GoalHeaderMetrics = memo<{ goalId: string }>(({ goalId }) => {
  const { t } = useTranslation('chat');
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  const openGoalMetric = useChatStore((s) => s.openGoalMetric);

  const latest = useMemo(() => {
    let value: Date | undefined;
    for (const node of snapshot?.nodes ?? []) {
      if (!value || node.updatedAt > value) value = node.updatedAt;
    }
    return value;
  }, [snapshot]);

  if (!snapshot) return null;

  const { goal, nodes } = snapshot;
  const tasks = nodes.filter((node) => node.kind === 'task').length;
  const findings = nodes.filter((node) => node.kind === 'finding').length;
  const open = (metric: GoalMetricKind) => () => openGoalMetric(goalId, metric);

  const durationText = goal.startedAt
    ? formatSpan((goal.completedAt ?? new Date()).getTime() - goal.startedAt.getTime())
    : '—';
  // Spend is the metric; the cap is the context it is read against — see
  // `summarizeGoalBudget`. The label names only the number in the lead, and the
  // cap trails it at secondary weight rather than sharing top billing.
  const budget = summarizeGoalBudget(goal, snapshot.spend);
  const budgetLabel = t(
    budget.kind === 'rounds' ? 'goalProcess.metrics.rounds' : 'goalProcess.metrics.spend',
  );
  const budgetLead =
    budget.kind === 'cost'
      ? formatUsd(budget.spent)
      : budget.kind === 'rounds'
        ? String(budget.runs)
        : formatUsd(budget.spent);
  const budgetTrail =
    budget.kind === 'cost'
      ? `/ ${formatUsd(budget.cap)}`
      : budget.kind === 'rounds'
        ? `/ ${t('goalProcess.metrics.roundsValue', { count: budget.cap })}`
        : t('goalProcess.metrics.uncapped');

  return (
    <Flexbox horizontal className={styles.metrics} gap={8} wrap={'wrap'}>
      <Metric
        label={t('goalProcess.metrics.status')}
        value={
          <>
            <GoalStatusGlyph size={16} status={goal.status} />
            <Text fontSize={16} weight={600}>
              {t(goalStatusKey(goal.status))}
            </Text>
          </>
        }
        onClick={open('lifecycle')}
      />
      <Metric
        label={t('goalProcess.metrics.tasks')}
        value={
          <Text fontSize={16} weight={600}>
            {tasks}
          </Text>
        }
        onClick={open('tasks')}
      />
      <Metric
        label={t('goalProcess.metrics.findings')}
        value={
          <Text fontSize={16} weight={600}>
            {findings}
          </Text>
        }
        onClick={open('findings')}
      />
      <Metric
        label={budgetLabel}
        value={
          <>
            <Text fontSize={16} weight={600}>
              {budgetLead}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {budgetTrail}
            </Text>
          </>
        }
        onClick={open('budget')}
      />
      <Metric
        label={t('goalProcess.metrics.duration')}
        value={
          <Text fontSize={16} weight={600}>
            {durationText}
          </Text>
        }
        onClick={open('duration')}
      />
      <Metric
        label={t('goalProcess.metrics.liveness')}
        value={<LivenessValue latest={latest} />}
        onClick={open('liveness')}
      />
    </Flexbox>
  );
});

GoalHeaderMetrics.displayName = 'GoalHeaderMetrics';

export default GoalHeaderMetrics;
