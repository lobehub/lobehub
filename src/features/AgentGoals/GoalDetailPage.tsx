'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PauseIcon, PlayIcon } from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import GoalDetailSkeleton from '@/components/Skeleton/GoalDetail';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import { useAgentRoutePath } from '@/features/AgentBreadcrumb/useAgentRoutePath';
import NavHeader from '@/features/NavHeader';
import { PortalContent } from '@/features/Portal/router';
import { usePortalPanelWidth } from '@/features/Portal/usePortalPanelWidth';
import RightPanel from '@/features/RightPanel';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useActivityTime } from '@/hooks/useActivityTime';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { type GoalMetricKind } from '@/store/chat/slices/portal/initialState';
import { goalSelectors, useGoalStore } from '@/store/goal';

import GoalChat from './GoalChat';
import GoalDetailActions from './GoalDetailActions';
import { formatSpan, formatUsd, goalStatusKey, summarizeGoalBudget } from './goalPresentation';
import GoalRequirement from './GoalRequirement';
import GoalStatusGlyph from './GoalStatusGlyph';
import ProcessControl from './ProcessControl';

/**
 * The goal detail page. A goal is a Goal Graph — it owns its own decomposition
 * and dispatches its own Tasks — so the page reads the graph snapshot directly and
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

/** Relative "last activity" readout; isolated so its refresh never re-renders the page.
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

interface GoalDetailPageProps {
  /** Absent for a goal with no responsible agent — e.g. one created from a project. */
  agentId?: string;
  goalId: string;
}

const GoalDetailPage = memo<GoalDetailPageProps>(({ agentId, goalId }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('create_content');
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const { error, isLoading, mutate } = useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  const pauseGoal = useGoalStore((s) => s.pauseGoal);
  const resumeGoal = useGoalStore((s) => s.resumeGoal);

  const buildAgentPath = useAgentRoutePath(agentId ?? '');

  const showPortal = useChatStore(chatPortalSelectors.showPortal);
  const currentViewType = useChatStore(chatPortalSelectors.currentViewType);
  const [chatOpen, setChatOpen] = useState(true);
  const openGoalMetric = useChatStore((s) => s.openGoalMetric);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  // While the exploration map runs fullscreen its overlay carries the portal
  // panel; ours unmounts so exactly one PortalContent is alive at a time.
  const [graphFullscreen, setGraphFullscreen] = useState(false);

  // Same per-view width grammar as the conversation portal, but remembered
  // under the 'goal' scope: resizing here never affects the chat surface.
  const { maxWidth, minWidth, updateWidth, width } = usePortalPanelWidth(currentViewType, 'goal');

  // The portal stack belongs to this goal's inspection session — leaving the
  // page (or switching goals) must not leak it into the conversation surface.
  useEffect(() => () => clearPortalStack(), [clearPortalStack, goalId]);

  const liveness = useMemo(() => {
    if (!snapshot) return { latest: undefined };
    let latest: Date | undefined;
    for (const node of snapshot.nodes) {
      if (!latest || node.updatedAt > latest) latest = node.updatedAt;
    }
    return { latest };
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

  // The panel hosts the goal conversation only when the goal has a
  // responsible agent; without one it is drill-down-only.
  const panelExpandable = !!agentId;
  const chatVisible = chatOpen && panelExpandable;

  const paused = goal.status === 'paused';
  // Pace control exists only while the coordinator loop is actually moving (or
  // explicitly paused). A goal in review awaits the human, and a closed goal
  // cannot move — pausing either would be a dead or misleading button.
  const canPause =
    canEdit &&
    nodes.length > 0 &&
    ['paused', 'planning', 'running', 'verifying'].includes(goal.status);

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
    <Flexbox horizontal flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
        <NavHeader
          left={
            <Flexbox horizontal align={'center'} gap={4}>
              {agentId ? (
                <AgentBreadcrumb
                  agentId={agentId}
                  extraItems={[goal.title]}
                  // The goal title owns the last crumb, so this one is a way back
                  // to the agent's goal list rather than a label for this page.
                  title={<Link to={buildAgentPath('goals')}>{t('goalList.title')}</Link>}
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
          right={
            graphFullscreen ? undefined : (
              /* Re-entry point for a collapsed panel: the GoalChat toolbar's
                 close button (or a drag under the collapse threshold) hides
                 the panel, and with `expandable={false}` on the panel itself
                 this header button is the only way back. Hidden while a
                 drill-down owns the panel — its header carries the close. */
              <ToggleRightPanelButton
                hideWhenExpanded
                expand={showPortal || chatVisible}
                onToggle={() => {
                  if (showPortal) {
                    clearPortalStack();
                    return;
                  }
                  if (panelExpandable) setChatOpen(true);
                }}
              />
            )
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
                  value={<LivenessValue latest={liveness.latest} />}
                  onClick={open('liveness')}
                />
              </Flexbox>
              {/* Pause/resume above the requirement document — its reviewed
                  home. The status glyph keeps the "running" animation; this
                  button is only the control. */}
              {canPause && (
                <Flexbox horizontal align={'center'} gap={10} paddingBlock={'8px 0'}>
                  <Button
                    icon={paused ? PlayIcon : PauseIcon}
                    type={paused ? 'primary' : 'default'}
                    onClick={() => void (paused ? resumeGoal(goal.id) : pauseGoal(goal.id))}
                  >
                    {paused ? t('goalProcess.resume') : t('goalProcess.pause')}
                  </Button>
                  {paused && (
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalProcess.paused')}
                    </Text>
                  )}
                </Flexbox>
              )}
              {goal.requirement && (
                <GoalRequirement goalId={goal.id} requirement={goal.requirement} />
              )}
            </Flexbox>

            <ProcessControl
              goalId={goal.id}
              graphFullscreen={graphFullscreen}
              onGraphFullscreenChange={setGraphFullscreen}
            />
          </WideScreenContainer>
        </Flexbox>
      </Flexbox>

      {/* Same Portal the conversation surface uses — the drill-down chain
          (metric / node → task detail → topic) rides its view stack, and the
          header's back arrow and close come for free. When no drill-down is
          open, the panel hosts the conversation with the goal's responsible
          agent so a user can just ask about progress. */}
      <RightPanel
        expand={(showPortal || chatVisible) && !graphFullscreen}
        maxWidth={maxWidth}
        minWidth={minWidth}
        width={width}
        onSizeChange={(size) => updateWidth(size?.width)}
        onExpandChange={(next) => {
          if (!next) clearPortalStack();
          setChatOpen(next);
        }}
      >
        {graphFullscreen ? null : showPortal ? (
          <PortalContent />
        ) : agentId ? (
          <GoalChat agentId={agentId} goalId={goalId} onCollapse={() => setChatOpen(false)} />
        ) : null}
      </RightPanel>
    </Flexbox>
  );
});

GoalDetailPage.displayName = 'GoalDetailPage';

export default GoalDetailPage;
