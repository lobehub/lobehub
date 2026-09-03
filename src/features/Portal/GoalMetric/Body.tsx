import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSpan } from '@/features/AgentGoals/goalPresentation';
import {
  buildGoalGraphView,
  type GoalGraphView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { KindDot } from '@/features/AgentGoals/ProcessControl/shared';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

/**
 * Drill-down behind each header metric of the goal detail page. Every view is
 * an honest projection of the `goal.graph` snapshot — where the product does
 * not yet model a number (per-round spend), the view says where the data
 * lives instead of inventing a value.
 */

const styles = createStaticStyles(({ css }) => ({
  label: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
  row: css`
    cursor: pointer;
    padding-block: 6px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  staticRow: css`
    padding-block: 4px;
  `,
}));

const NodeRow = memo<{
  extra?: ReactNode;
  goalId: string;
  nodeId: string;
  graph: GoalGraphView;
}>(({ extra, goalId, graph, nodeId }) => {
  const openGoalNode = useChatStore((s) => s.openGoalNode);
  const view = graph.byId[nodeId];
  if (!view) return null;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.row}
      gap={8}
      onClick={() => openGoalNode(goalId, nodeId)}
    >
      {view.seq !== undefined && (
        <Text className={styles.mono} fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
          #{view.seq}
        </Text>
      )}
      <KindDot kind={view.node.kind} />
      <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
        {view.node.title}
      </Text>
      {extra}
    </Flexbox>
  );
});

NodeRow.displayName = 'GoalMetricNodeRow';

const Lifecycle = memo<{ goalId: string; graph: GoalGraphView }>(({ graph }) => {
  const { t } = useTranslation('chat');
  const snapshot = useGoalStore(goalSelectors.goalGraph(graph.goal.id));
  const events = useMemo(
    () =>
      [...(snapshot?.events ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [snapshot],
  );

  if (events.length === 0)
    return (
      <Text fontSize={13} type={'secondary'}>
        {t('goalProcess.metricDetail.lifecycle.empty')}
      </Text>
    );

  return (
    <Flexbox gap={0}>
      {events.map((event) => {
        const subject = graph.byId[event.entityId]?.node.title;
        return (
          <Flexbox
            horizontal
            align={'baseline'}
            className={styles.staticRow}
            gap={10}
            key={event.id}
          >
            <Text className={styles.mono} fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
              {dayjs(event.createdAt).format('MM-DD HH:mm')}
            </Text>
            <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
              <Text fontSize={13}>
                {t(`goalProcess.eventType.${event.eventType}` as const)}
                {subject ? ` · ${subject}` : ''}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {t(`goalProcess.actor.${event.actorType}` as const)}
                {event.reason ? ` · ${event.reason}` : ''}
              </Text>
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

Lifecycle.displayName = 'GoalMetricLifecycle';

const Tasks = memo<{ goalId: string; graph: GoalGraphView }>(({ goalId, graph }) => {
  const { t } = useTranslation('chat');
  const works = graph.nodes.filter((view) => view.node.kind === 'task');

  return (
    <Flexbox gap={0}>
      {works.map((view) => (
        <NodeRow
          goalId={goalId}
          graph={graph}
          key={view.node.id}
          nodeId={view.node.id}
          extra={
            <Tag size={'small'}>{t(`goalProcess.nodeStatus.${view.node.status}` as const)}</Tag>
          }
        />
      ))}
    </Flexbox>
  );
});

Tasks.displayName = 'GoalMetricTasks';

const Findings = memo<{ goalId: string; graph: GoalGraphView }>(({ goalId, graph }) => {
  const { t } = useTranslation('chat');
  const findings = [...graph.findings].sort(
    (a, b) =>
      (b.node.resolvedAt ?? b.node.createdAt).getTime() -
      (a.node.resolvedAt ?? a.node.createdAt).getTime(),
  );

  return (
    <Flexbox gap={0}>
      {findings.map((view) => (
        <NodeRow
          goalId={goalId}
          graph={graph}
          key={view.node.id}
          nodeId={view.node.id}
          extra={
            view.producedBy ? (
              <Text
                ellipsis
                fontSize={12}
                style={{ flexShrink: 1, minWidth: 0 }}
                type={'secondary'}
              >
                {t('goalProcess.findings.from', { title: view.producedBy.title })}
              </Text>
            ) : undefined
          }
        />
      ))}
    </Flexbox>
  );
});

Findings.displayName = 'GoalMetricFindings';

const Budget = memo<{ graph: GoalGraphView }>(({ graph }) => {
  const { t } = useTranslation('chat');
  const { maxRounds, maxTotalCost } = graph.goal;

  return (
    <Flexbox gap={14}>
      <Flexbox gap={2}>
        <span className={styles.label}>{t('goalProcess.metricDetail.budget.totalCost')}</span>
        <Text className={styles.mono} style={{ fontSize: 20 }} weight={600}>
          {maxTotalCost === null
            ? t('goalProcess.metricDetail.budget.uncapped')
            : `$${maxTotalCost}`}
        </Text>
      </Flexbox>
      <Flexbox gap={2}>
        <span className={styles.label}>{t('goalProcess.metricDetail.budget.rounds')}</span>
        <Text className={styles.mono} style={{ fontSize: 20 }} weight={600}>
          {maxRounds === null ? t('goalProcess.metricDetail.budget.uncapped') : maxRounds}
        </Text>
      </Flexbox>
      {/* Per-round spend is recorded on each dispatched Task, not on the goal
          row — say so instead of rendering a fabricated total. */}
      <Text fontSize={12} type={'secondary'}>
        {t('goalProcess.metricDetail.budget.spendNote')}
      </Text>
    </Flexbox>
  );
});

Budget.displayName = 'GoalMetricBudget';

const Duration = memo<{ goalId: string; graph: GoalGraphView }>(({ goalId, graph }) => {
  const { t } = useTranslation('chat');
  const { completedAt, startedAt } = graph.goal;
  const end = completedAt ?? new Date();
  const works = graph.nodes.filter((view) => view.node.kind === 'task' && view.attempts.length > 0);

  return (
    <Flexbox gap={14}>
      {startedAt && (
        <Flexbox gap={2}>
          <span className={styles.label}>{t('goalProcess.metricDetail.duration.total')}</span>
          <Text className={styles.mono} style={{ fontSize: 20 }} weight={600}>
            {formatSpan(end.getTime() - startedAt.getTime())}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {dayjs(startedAt).format('MM-DD HH:mm')} →{' '}
            {completedAt
              ? dayjs(completedAt).format('MM-DD HH:mm')
              : t('goalProcess.metricDetail.duration.now')}
          </Text>
        </Flexbox>
      )}
      <Flexbox gap={4}>
        <span className={styles.label}>{t('goalProcess.metricDetail.duration.taskSpans')}</span>
        <Flexbox gap={0}>
          {works.map((view) => {
            const first = view.attempts[0];
            const last = view.attempts.at(-1)!;
            const spanEnd = last.endedAt ?? new Date();
            return (
              <NodeRow
                goalId={goalId}
                graph={graph}
                key={view.node.id}
                nodeId={view.node.id}
                extra={
                  <Text
                    className={styles.mono}
                    fontSize={12}
                    style={{ flex: 'none' }}
                    type={'secondary'}
                  >
                    {dayjs(first.startedAt).format('HH:mm')}–
                    {last.endedAt ? dayjs(last.endedAt).format('HH:mm') : '…'} ·{' '}
                    {formatSpan(spanEnd.getTime() - first.startedAt.getTime())}
                  </Text>
                }
              />
            );
          })}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

Duration.displayName = 'GoalMetricDuration';

const Liveness = memo<{ goalId: string; graph: GoalGraphView }>(({ goalId, graph }) => {
  const { t } = useTranslation('chat');
  const latest = useMemo(
    () =>
      graph.nodes.reduce<Date | undefined>((max, view) => {
        const at = view.node.updatedAt;
        return !max || at > max ? at : max;
      }, undefined),
    [graph],
  );
  const running = graph.nodes.filter(
    (view) => view.node.kind === 'task' && view.node.status === 'active',
  );

  return (
    <Flexbox gap={14}>
      <Flexbox gap={2}>
        <span className={styles.label}>{t('goalProcess.metricDetail.liveness.latest')}</span>
        <Text className={styles.mono} style={{ fontSize: 20 }} weight={600}>
          {latest ? dayjs(latest).format('MM-DD HH:mm') : '—'}
        </Text>
      </Flexbox>
      {running.length > 0 && (
        <Flexbox gap={4}>
          <span className={styles.label}>{t('goalProcess.metricDetail.liveness.running')}</span>
          <Flexbox gap={0}>
            {running.map((view) => (
              <NodeRow goalId={goalId} graph={graph} key={view.node.id} nodeId={view.node.id} />
            ))}
          </Flexbox>
        </Flexbox>
      )}
      {/* The contract that makes "walk away" safe: event-driven advancement
          plus the recovery sweep. State it where the user checks for a pulse. */}
      <Text fontSize={12} style={{ lineHeight: 1.7 }} type={'secondary'}>
        {t('goalProcess.metricDetail.liveness.driver')}
      </Text>
    </Flexbox>
  );
});

Liveness.displayName = 'GoalMetricLiveness';

const Body = memo(() => {
  const view = useChatStore(chatPortalSelectors.goalMetricView);
  const snapshot = useGoalStore(goalSelectors.goalGraph(view?.goalId ?? ''));
  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

  if (!view || !graph) return null;
  const { goalId, metric } = view;

  return (
    <Flexbox flex={1} padding={16} style={{ minHeight: 0, overflowY: 'auto' }}>
      {metric === 'lifecycle' && <Lifecycle goalId={goalId} graph={graph} />}
      {metric === 'tasks' && <Tasks goalId={goalId} graph={graph} />}
      {metric === 'findings' && <Findings goalId={goalId} graph={graph} />}
      {metric === 'budget' && <Budget graph={graph} />}
      {metric === 'duration' && <Duration goalId={goalId} graph={graph} />}
      {metric === 'liveness' && <Liveness goalId={goalId} graph={graph} />}
    </Flexbox>
  );
});

export default Body;
