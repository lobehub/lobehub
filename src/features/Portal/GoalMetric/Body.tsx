import type { GoalSpend } from '@lobechat/types';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Text, toast } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { formatSpan, formatUsd } from '@/features/AgentGoals/goalPresentation';
import AssigneeProfileAvatar from '@/features/AgentGoals/ProcessControl/AssigneeProfileAvatar';
import {
  buildGoalGraphView,
  type GoalGraphView,
  type GoalNodeView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { KindDot } from '@/features/AgentGoals/ProcessControl/shared';
import { formatElapsed, useElapsed } from '@/features/AgentGoals/ProcessControl/useElapsed';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { formatTaskItemDate } from '@/features/AgentTasks/features/formatTaskItemDate';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { taskRowSpan, type TaskRowState, taskRowState, taskRowStateLabelKey } from './taskRowState';

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
  /** Sits right after the title rather than at the row's far end. */
  afterTitle?: ReactNode;
  extra?: ReactNode;
  goalId: string;
  nodeId: string;
  graph: GoalGraphView;
  /**
   * Replaces the kind dot — the status glyph, when every row is the same kind,
   * as on the Task list.
   */
  leading?: ReactNode;
}>(({ afterTitle, extra, goalId, graph, leading, nodeId }) => {
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
      {leading ?? <KindDot kind={view.node.kind} />}
      <Text ellipsis style={{ flex: afterTitle ? '0 1 auto' : 1, minWidth: 0 }} weight={500}>
        {view.node.title}
      </Text>
      {afterTitle}
      {afterTitle && <Flexbox flex={1} />}
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

/**
 * How long the Task has taken across every attempt — a live clock only while
 * it is genuinely running, a frozen span otherwise. A Task that was never
 * dispatched has nothing to show.
 */
const TaskDuration = memo<{ view: GoalNodeView }>(({ view }) => {
  const span = taskRowSpan(view);
  const elapsed = useElapsed(span && !span.endedAt ? span.startedAt : undefined);
  if (!span) return null;

  return (
    <Text className={styles.mono} fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
      {span.endedAt ? formatElapsed(span.endedAt.getTime() - span.startedAt.getTime()) : elapsed}
    </Text>
  );
});

TaskDuration.displayName = 'GoalMetricTaskDuration';

/**
 * When the Task started, in the Task list's own date column — same format and
 * width, with the exact start → end one hover away. An undispatched Task still
 * holds the column so the avatars stay aligned.
 */
const TaskStartDate = memo<{ view: GoalNodeView }>(({ view }) => {
  const { t, i18n } = useTranslation('common');
  const span = taskRowSpan(view);
  const date = span
    ? formatTaskItemDate(span.startedAt, {
        formatOtherYear: t('time.formatOtherYear'),
        formatThisYear: t('time.formatThisYear'),
        locale: i18n.language,
      })
    : '';

  return (
    <Text
      align={'right'}
      fontSize={12}
      style={{ flex: 'none', whiteSpace: 'nowrap', width: 48 }}
      type={'secondary'}
      title={
        span
          ? `${dayjs(span.startedAt).format('YYYY-MM-DD HH:mm:ss')} → ${
              span.endedAt ? dayjs(span.endedAt).format('YYYY-MM-DD HH:mm:ss') : '…'
            }`
          : undefined
      }
    >
      {date}
    </Text>
  );
});

TaskStartDate.displayName = 'GoalMetricTaskStartDate';

/** The Task-list visual for each row state; `running` draws the animated ring instead. */
const STATE_VISUAL = {
  decision: TASK_STATUS_VISUALS.paused,
  done: TASK_STATUS_VISUALS.completed,
  lost: TASK_STATUS_VISUALS.failed,
  queued: TASK_STATUS_VISUALS.backlog,
  retired: TASK_STATUS_VISUALS.canceled,
} as const satisfies Record<Exclude<TaskRowState, 'running'>, unknown>;

/**
 * A Task node's state as the leading glyph the Task list uses — the same marks
 * the goal page's own frontier draws, so a row reads the same in both places.
 * The status name stays one hover away, worded from the same state as the icon.
 */
const TaskStatusGlyph = memo<{ view: GoalNodeView }>(({ view }) => {
  const { t } = useTranslation('chat');
  const state = taskRowState(view);

  return (
    <Tooltip title={t(taskRowStateLabelKey(view, state))}>
      <span style={{ display: 'inline-flex', flex: 'none' }}>
        {state === 'running' ? (
          <RunningGlyph size={16} />
        ) : (
          <Icon color={STATE_VISUAL[state].color} icon={STATE_VISUAL[state].icon} size={16} />
        )}
      </span>
    </Tooltip>
  );
});

TaskStatusGlyph.displayName = 'GoalMetricTaskStatusGlyph';

/** Laid out like a Task list row: number and state, the title, then who is on it and when. */
const Tasks = memo<{ goalId: string; graph: GoalGraphView }>(({ goalId, graph }) => {
  const works = graph.nodes.filter((view) => view.node.kind === 'task');

  return (
    <Flexbox gap={0}>
      {works.map((view) => (
        <NodeRow
          afterTitle={<TaskDuration view={view} />}
          goalId={goalId}
          graph={graph}
          key={view.node.id}
          leading={<TaskStatusGlyph view={view} />}
          nodeId={view.node.id}
          extra={
            <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
              {view.assigneeAgentId ? (
                <AssigneeProfileAvatar agentId={view.assigneeAgentId} />
              ) : (
                <AssigneeAvatar />
              )}
              <TaskStartDate view={view} />
            </Flexbox>
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

/**
 * One budget dimension as `spent / cap`, where the cap IS the input — the
 * number you read and the number you change are the same number, so raising a
 * budget needs no separate edit mode.
 *
 * The draft is local and commits on blur / Enter: the goal graph polls while
 * the goal runs, and binding the field straight to the snapshot would wipe
 * half-typed digits on every refresh.
 */
const BudgetField = memo<{
  cap: number | null;
  goalId: string;
  label: string;
  /** `maxTotalCost` is money and takes a `$`; `maxRounds` is a plain count. */
  money?: boolean;
  used: number;
}>(({ cap, goalId, label, money, used }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('create_content');
  const setGoalBudget = useGoalStore((s) => s.setGoalBudget);
  const [draft, setDraft] = useState<number | null>(cap);
  const [saving, setSaving] = useState(false);

  // Re-seed from the server whenever it disagrees and the user is not mid-edit.
  const [committed, setCommitted] = useState(cap);
  if (committed !== cap && !saving) {
    setCommitted(cap);
    setDraft(cap);
  }

  const commit = async () => {
    if (!canEdit || draft === cap) return;
    // A cap below what the goal already spent would park it immediately; that
    // is a legitimate way to stop a goal, so it is allowed — only nonsense
    // (negative, zero) is refused, matching the router's `positive()`.
    if (draft !== null && draft <= 0) {
      setDraft(cap);
      return;
    }

    try {
      setSaving(true);
      // Only the field that changed is sent: `setBudget` treats an omitted
      // dimension as untouched, so editing the cost cap keeps the round cap.
      await setGoalBudget(goalId, money ? { maxTotalCost: draft } : { maxRounds: draft });
    } catch (error) {
      console.error('[GoalMetricBudget] Failed to save:', error);
      toast.error(t('goalProcess.metricDetail.budget.saveFailed'));
      setDraft(cap);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={2}>
      <span className={styles.label}>{label}</span>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text className={styles.mono} style={{ fontSize: 20 }} weight={600}>
          {money ? formatUsd(used) : used}
        </Text>
        <Text className={styles.mono} style={{ fontSize: 20 }} type={'secondary'}>
          /
        </Text>
        <InputNumber
          className={styles.mono}
          controls={false}
          disabled={!canEdit || saving}
          min={0}
          placeholder={t('goalProcess.metricDetail.budget.uncapped')}
          size={'small'}
          style={{ width: 120 }}
          value={draft}
          variant={'filled'}
          prefix={
            money ? (
              <Text fontSize={12} type={'secondary'}>
                $
              </Text>
            ) : undefined
          }
          onBlur={() => void commit()}
          onChange={setDraft}
          onPressEnter={() => void commit()}
        />
      </Flexbox>
    </Flexbox>
  );
});

BudgetField.displayName = 'GoalMetricBudgetField';

/** `12.4k` — token counts are read for magnitude, not audited digit by digit. */
const formatTokens = (value: number): string =>
  value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value);

/**
 * Where the money went, one row per dispatched Task. The caps above answer
 * "how much is left"; without this the panel could not answer the question a
 * user actually arrives with — which Task is eating the budget.
 *
 * Rows are ordered by spend, and a Task whose runs have not settled shows $0
 * rather than being dropped: it is still consuming rounds.
 */
const CostBreakdown = memo<{ goalId: string; graph: GoalGraphView; spend?: GoalSpend }>(
  ({ goalId, graph, spend }) => {
    const { t } = useTranslation('chat');
    const openGoalNode = useChatStore((s) => s.openGoalNode);

    const rows = useMemo(() => {
      const nodeByTaskId = new Map(
        graph.nodes
          .filter((view) => view.node.taskId)
          .map((view) => [view.node.taskId!, view] as const),
      );
      return (spend?.byTask ?? [])
        .map((row) => ({ ...row, view: nodeByTaskId.get(row.taskId) }))
        .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens);
    }, [graph, spend]);

    if (rows.length === 0)
      return (
        <Text fontSize={13} type={'secondary'}>
          {t('goalProcess.metricDetail.budget.perTaskEmpty')}
        </Text>
      );

    return (
      <Flexbox gap={4}>
        <span className={styles.label}>{t('goalProcess.metricDetail.budget.perTaskTitle')}</span>
        <Flexbox gap={0}>
          {rows.map((row) => {
            const body = (
              <Flexbox horizontal align={'center'} gap={8} key={row.taskId}>
                {row.view?.seq !== undefined && (
                  <Text
                    className={styles.mono}
                    fontSize={12}
                    style={{ flex: 'none' }}
                    type={'secondary'}
                  >
                    #{row.view.seq}
                  </Text>
                )}
                <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                  {row.view?.node.title ?? row.taskId}
                </Text>
                <Text
                  className={styles.mono}
                  fontSize={12}
                  style={{ flex: 'none' }}
                  type={'secondary'}
                >
                  {t('goalProcess.metricDetail.budget.tokensValue', {
                    value: formatTokens(row.totalTokens),
                  })}
                </Text>
                <Text className={styles.mono} style={{ flex: 'none' }} weight={500}>
                  {formatUsd(row.totalCost)}
                </Text>
              </Flexbox>
            );

            // A row without a graph node is a Task the snapshot no longer
            // carries — still billed, but nothing to open.
            return row.view ? (
              <Flexbox
                className={styles.row}
                key={row.taskId}
                onClick={() => openGoalNode(goalId, row.view!.node.id)}
              >
                {body}
              </Flexbox>
            ) : (
              <Flexbox className={styles.staticRow} key={row.taskId}>
                {body}
              </Flexbox>
            );
          })}
        </Flexbox>
      </Flexbox>
    );
  },
);

CostBreakdown.displayName = 'GoalMetricCostBreakdown';

const Budget = memo<{ goalId: string; graph: GoalGraphView }>(({ goalId, graph }) => {
  const { t } = useTranslation('chat');
  const { maxRounds, maxTotalCost } = graph.goal;
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  const spend = snapshot?.spend;

  return (
    <Flexbox gap={20}>
      <Flexbox gap={14}>
        <span className={styles.label}>{t('goalProcess.metricDetail.budget.controlTitle')}</span>
        <BudgetField
          money
          cap={maxTotalCost}
          goalId={goalId}
          label={t('goalProcess.metricDetail.budget.totalCost')}
          used={spend?.totalCost ?? 0}
        />
        <BudgetField
          cap={maxRounds}
          goalId={goalId}
          label={t('goalProcess.metricDetail.budget.rounds')}
          used={spend?.runs ?? 0}
        />
        {/* Raising a cap is how a user restarts a goal the coordinator parked on
            one — say so, because the alternative gesture (Resume) looks like the
            obvious one and does nothing while the budget is still binding. */}
        <Text fontSize={12} style={{ lineHeight: 1.7 }} type={'secondary'}>
          {t('goalProcess.metricDetail.budget.raiseNote')}
        </Text>
      </Flexbox>
      <CostBreakdown goalId={goalId} graph={graph} spend={spend} />
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
  // Fetched here so the metric drill-down also works outside the goal page.
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  useFetchGoalGraph(view?.goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(view?.goalId ?? ''));
  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

  if (!view || !graph) return null;
  const { goalId, metric } = view;

  return (
    <Flexbox flex={1} padding={16} style={{ minHeight: 0, overflowY: 'auto' }}>
      {metric === 'lifecycle' && <Lifecycle goalId={goalId} graph={graph} />}
      {metric === 'tasks' && <Tasks goalId={goalId} graph={graph} />}
      {metric === 'findings' && <Findings goalId={goalId} graph={graph} />}
      {metric === 'budget' && <Budget goalId={goalId} graph={graph} />}
      {metric === 'duration' && <Duration goalId={goalId} graph={graph} />}
      {metric === 'liveness' && <Liveness goalId={goalId} graph={graph} />}
    </Flexbox>
  );
});

export default Body;
