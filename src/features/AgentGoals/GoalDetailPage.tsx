'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import CollapsibleContent from '@/components/CollapsibleContent';
import GoalDetailSkeleton from '@/components/Skeleton/GoalDetail';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import NavHeader from '@/features/NavHeader';
import { PortalContent } from '@/features/Portal/router';
import RightPanel from '@/features/RightPanel';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { type GoalMetricKind } from '@/store/chat/slices/portal/initialState';
import { goalSelectors, useGoalStore } from '@/store/goal';

import GoalDetailActions from './GoalDetailActions';
import { formatSpan, goalStatusKey } from './goalPresentation';
import GoalStatusGlyph from './GoalStatusGlyph';
import ProcessControl from './ProcessControl';

/**
 * The goal detail page. A goal is a Goal Graph — it owns its own decomposition
 * and dispatches Work Tasks — so the page reads the graph snapshot directly and
 * the route is keyed by the `goals` row id.
 *
 * Every header metric is a drill-down entry: clicking one opens its detail in
 * the right-hand Portal, the same panel the process-control band drills into
 * (node → task → topic conversation).
 */

const styles = createStaticStyles(({ css }) => ({
  header: css`
    padding-block: 8px 4px;
  `,
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

/** Relative "last activity" readout; isolated so its refresh never re-renders the page. */
const LivenessValue = memo<{ active: boolean; latest?: Date }>(({ active, latest }) => {
  const { text } = useActivityTime(latest);
  return (
    <>
      {active && <RunningGlyph size={14} />}
      <Text fontSize={16} weight={600}>
        {text || '—'}
      </Text>
    </>
  );
});

LivenessValue.displayName = 'GoalLivenessValue';

interface GoalDetailPageProps {
  /** Absent for a goal with no responsible agent — e.g. one created from a project. */
  agentId?: string;
  goalId: string;
}

const GoalDetailPage = memo<GoalDetailPageProps>(({ agentId, goalId }) => {
  const { t } = useTranslation('chat');
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const { error, isLoading, mutate } = useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));

  const showPortal = useChatStore(chatPortalSelectors.showPortal);
  const openGoalMetric = useChatStore((s) => s.openGoalMetric);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  // The portal stack belongs to this goal's inspection session — leaving the
  // page (or switching goals) must not leak it into the conversation surface.
  useEffect(() => () => clearPortalStack(), [clearPortalStack, goalId]);

  const liveness = useMemo(() => {
    if (!snapshot) return { active: false, latest: undefined };
    let latest: Date | undefined;
    let active = false;
    for (const node of snapshot.nodes) {
      if (!latest || node.updatedAt > latest) latest = node.updatedAt;
      if (node.kind === 'task' && node.status === 'active') active = true;
    }
    return { active, latest };
  }, [snapshot]);

  if (error && !snapshot) return <AsyncError error={error} variant={'page'} onRetry={mutate} />;
  if (!snapshot)
    return isLoading ? (
      <GoalDetailSkeleton />
    ) : (
      <NotFound desc={t('goalDetail.notFoundDescription')} title={t('goalDetail.notFoundTitle')} />
    );

  const { goal, nodes } = snapshot;
  const tasks = nodes.filter((node) => node.kind === 'task').length;
  const findings = nodes.filter((node) => node.kind === 'finding').length;
  const open = (metric: GoalMetricKind) => () => openGoalMetric(goalId, metric);

  const durationText = goal.startedAt
    ? formatSpan((goal.completedAt ?? new Date()).getTime() - goal.startedAt.getTime())
    : '—';
  const budgetText =
    goal.maxTotalCost === null
      ? goal.maxRounds === null
        ? t('goalProcess.metrics.uncapped')
        : t('goalProcess.metrics.roundsValue', { count: goal.maxRounds })
      : `$${goal.maxTotalCost}`;

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
        <NavHeader
          left={
            <Flexbox horizontal align={'center'} gap={4}>
              {agentId ? (
                <AgentBreadcrumb
                  agentId={agentId}
                  extraItems={[goal.title]}
                  title={t('goalList.title')}
                />
              ) : (
                <Text fontSize={14} weight={500}>
                  {goal.title}
                </Text>
              )}
              {/* Not nested under the breadcrumb: an agent-less goal still has to
                  be deletable, and this menu is the only place that can do it. */}
              <GoalDetailActions agentId={agentId} goalId={goal.id} projectId={goal.projectId} />
            </Flexbox>
          }
        />
        <Flexbox flex={1} style={{ overflowY: 'auto' }}>
          <WideScreenContainer gap={20} paddingBlock={16}>
            <Flexbox className={styles.header} gap={8}>
              <Text as={'h1'} fontSize={22} weight={600}>
                {goal.title}
              </Text>
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
                  label={t('goalProcess.metrics.budget')}
                  value={
                    <Text fontSize={16} weight={600}>
                      {budgetText}
                    </Text>
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
                  value={<LivenessValue active={liveness.active} latest={liveness.latest} />}
                  onClick={open('liveness')}
                />
              </Flexbox>
              {goal.requirement && (
                <Flexbox gap={4} paddingBlock={'8px 0'}>
                  <Text fontSize={12} type={'secondary'} weight={500}>
                    {t('goalProcess.requirement')}
                  </Text>
                  {/* Generated acceptance criteria run long — clamp like the task
                      instruction does, with the shared show-more affordance. */}
                  <CollapsibleContent maxHeight={160}>
                    <Text fontSize={14} style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                      {goal.requirement}
                    </Text>
                  </CollapsibleContent>
                </Flexbox>
              )}
            </Flexbox>

            <ProcessControl goalId={goal.id} />
          </WideScreenContainer>
        </Flexbox>
      </Flexbox>

      {/* Same Portal the conversation surface uses — the drill-down chain
          (metric / node → task detail → topic) rides its view stack, and the
          header's back arrow and close come for free. */}
      <RightPanel
        defaultWidth={440}
        expand={showPortal}
        maxWidth={720}
        minWidth={360}
        onExpandChange={(next) => {
          if (!next) clearPortalStack();
        }}
      >
        <PortalContent />
      </RightPanel>
    </Flexbox>
  );
});

GoalDetailPage.displayName = 'GoalDetailPage';

export default GoalDetailPage;
