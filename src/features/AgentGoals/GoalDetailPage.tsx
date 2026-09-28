'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { EyeIcon, PauseIcon, PlayIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
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
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

import GoalChat from './GoalChat';
import GoalDetailActions from './GoalDetailActions';
import GoalHeaderMetrics from './GoalHeaderMetrics';
import { goalManagerConversation } from './goalPresentation';
import GoalRequirement from './GoalRequirement';
import { GoalSupervision } from './GoalSupervision';
import NorthStarMetrics from './NorthStarMetrics';
import ProcessControl from './ProcessControl';
import { useGoalChatPanel } from './useGoalChatPanel';

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
}));

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
  const chat = useGoalChatPanel(goalId, agentId);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  // While the exploration map runs fullscreen its overlay carries the portal
  // panel; ours unmounts so exactly one PortalContent is alive at a time.
  const [graphFullscreen, setGraphFullscreen] = useState(false);

  // Same per-view width grammar as the conversation portal, but remembered
  // under the 'goal' scope: resizing here never affects the chat surface.
  const { maxWidth, minWidth, updateWidth, width } = usePortalPanelWidth(currentViewType, 'goal');

  /**
   * Give a drill-down its reading room by folding the app rail, not the goal.
   *
   * Opened beside the goal, the Portal used to leave both panes cramped — the
   * goal's title wrapping to four lines, its task rows truncated to a few
   * characters. Folding the goal pane itself was tried and is wrong: it hides
   * the task's own verification state, which is exactly what the reader drilled
   * in to check. The rail is the one thing on screen that no one is reading.
   *
   * `showLeftPanel` is a persisted preference, so this only ever restores what
   * it collapsed: a user who already works with the rail folded is left alone,
   * and one who folds or opens it themselves while a drill-down is up keeps
   * that choice.
   */
  const showLeftPanel = useGlobalStore(systemStatusSelectors.showLeftPanel);
  const toggleLeftPanel = useGlobalStore((s) => s.toggleLeftPanel);
  const collapsedRailRef = useRef(false);

  useEffect(() => {
    if (showPortal) {
      if (showLeftPanel && !collapsedRailRef.current) {
        collapsedRailRef.current = true;
        toggleLeftPanel(false);
      }
      return;
    }
    if (collapsedRailRef.current) {
      collapsedRailRef.current = false;
      toggleLeftPanel(true);
    }
  }, [showPortal, showLeftPanel, toggleLeftPanel]);

  // Leaving the page with the rail still folded would strand it on every other
  // surface, so give it back on the way out.
  useEffect(
    () => () => {
      if (collapsedRailRef.current) {
        collapsedRailRef.current = false;
        useGlobalStore.getState().toggleLeftPanel(true);
      }
    },
    [],
  );

  // The portal stack belongs to this goal's inspection session — leaving the
  // page (or switching goals) must not leak it into the conversation surface.
  useEffect(() => () => clearPortalStack(), [clearPortalStack, goalId]);

  if (error && !snapshot) return <AsyncError error={error} variant={'page'} onRetry={mutate} />;
  if (!snapshot)
    return isLoading ? (
      <GoalDetailSkeleton />
    ) : (
      <NotFound desc={t('goalDetail.notFoundDescription')} title={t('goalDetail.notFoundTitle')} />
    );

  const { goal, nodes } = snapshot;
  const managerConversation = goalManagerConversation(goal);

  // The panel hosts the goal conversation only when the goal has a
  // responsible agent; without one it is drill-down-only.
  const panelExpandable = !!chat.agentId;
  const chatVisible = chat.open && panelExpandable;

  const paused = goal.status === 'paused';
  // Pace control exists only while the coordinator loop is actually moving (or
  // explicitly paused). A goal in review awaits the human, and a closed goal
  // cannot move — pausing either would be a dead or misleading button.
  const canPause =
    canEdit &&
    nodes.length > 0 &&
    ['paused', 'planning', 'running', 'verifying'].includes(goal.status);

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
              <Flexbox horizontal align={'center'} gap={8}>
                {managerConversation && (
                  <Button
                    icon={EyeIcon}
                    size={'small'}
                    onClick={() => {
                      clearPortalStack();
                      chat.openSupervision(managerConversation);
                    }}
                  >
                    {t('goalProcess.manager.viewTrace')}
                  </Button>
                )}
                {panelExpandable && (
                  <ToggleRightPanelButton
                    hideWhenExpanded
                    expand={showPortal || chatVisible}
                    onToggle={() => chat.setOpen(true)}
                  />
                )}
              </Flexbox>
            )
          }
        />
        <Flexbox flex={1} style={{ overflowY: 'auto' }}>
          <WideScreenContainer gap={20} paddingBlock={16}>
            <Flexbox className={styles.header} gap={8}>
              <Text as={'h1'} fontSize={22} weight={600}>
                {goal.title}
              </Text>
              <GoalHeaderMetrics goalId={goalId} />
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
              {/* North-star strip beside the requirement document: the measured
                  clauses ARE half of the acceptance contract, so they read
                  with it — not squeezed between the title and the execution
                  metrics (review feedback, r1). */}
              <NorthStarMetrics canEdit={canEdit} goalId={goalId} />
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
          chat.setOpen(next);
        }}
      >
        {graphFullscreen ? null : showPortal ? (
          <PortalContent />
        ) : chat.agentId && chat.topicId ? (
          <GoalSupervision
            agentId={chat.agentId}
            goalId={goalId}
            key={`${goalId}:${chat.agentId}:${chat.request}`}
            topicId={chat.topicId}
            onCollapse={() => chat.setOpen(false)}
          />
        ) : chat.agentId ? (
          <GoalChat
            agentId={chat.agentId}
            goalId={goalId}
            initialTopicId={chat.topicId}
            key={`${goalId}:${chat.agentId}:${chat.request}`}
            onCollapse={() => chat.setOpen(false)}
          />
        ) : null}
      </RightPanel>
    </Flexbox>
  );
});

GoalDetailPage.displayName = 'GoalDetailPage';

export default GoalDetailPage;
