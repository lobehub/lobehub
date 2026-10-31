'use client';

import { Button, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clock3,
  LoaderCircle,
  Workflow,
} from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import AssigneeProfileAvatar from '@/features/AgentGoals/ProcessControl/AssigneeProfileAvatar';
import { useChatStore } from '@/store/chat';
import { sx } from '@/styles/sx';

import {
  buildGoalStepSegments,
  type GoalWorkflowRow,
  MAX_VISIBLE_WORKFLOW_ROWS,
  sliceVisibleWorkflowRows,
  toSegmentStatuses,
} from './goalWorkflowView';
import { type GoalWorkflowView, useGoalWorkflow } from './useGoalSection';

const stepPulse = stylex.keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.45 },
});

const styles = stylex.create({
  count: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  decisionRow: {
    cursor: 'pointer',
    marginBlockStart: '2px',
    marginBlockEnd: '6px',
    paddingBlock: '5px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorWarningBorder,
    borderRadius: '6px',
    fontSize: '12px',
    color: cssVar.colorWarning,
    backgroundColor: { 'default': cssVar.colorWarningBg, ':hover': cssVar.colorWarningBorder },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  footer: { paddingBlockStart: '6px', paddingBlockEnd: '2px', paddingInline: '10px' },
  headerRow: {
    cursor: 'pointer',
    userSelect: 'none',
    paddingBlockStart: '4px',
    paddingBlockEnd: '6px',
    paddingInline: '10px',
    borderRadius: '6px',
    transition: 'background-color 0.12s ease',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  lessRow: {
    cursor: 'pointer',
    justifyContent: 'center',
    paddingBlock: '4px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
  },
  moreRow: {
    cursor: 'pointer',
    justifyContent: 'center',
    marginBlockStart: '2px',
    paddingBlock: '5px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    borderRadius: '6px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  progress: {
    overflow: 'hidden',
    flex: '1',
    height: '4px',
    borderRadius: '2px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  progressFill: {
    height: '100%',
    borderRadius: 'inherit',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
    transition: `width 0.25s ${cssVar.motionEaseOut}`,
  },
  row: {
    cursor: 'pointer',
    paddingBlock: '5px',
    paddingInline: '8px',
    borderRadius: '6px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  loading: { paddingBlockStart: '4px', paddingBlockEnd: '8px', paddingInline: '10px' },
  segActive: {
    backgroundColor: cssVar.colorInfo,
    backgroundImage: 'none',
    animationName: stepPulse,
    animationDuration: '1.6s',
    animationTimingFunction: cssVar.motionEaseInOut,
    animationIterationCount: 'infinite',
  },
  segDone: { backgroundColor: cssVar.colorSuccess, backgroundImage: 'none' },
  segPending: { backgroundColor: cssVar.colorFillSecondary, backgroundImage: 'none' },
  segment: { flex: '1', height: '4px', borderRadius: '2px' },
  stepTrack: {
    display: 'flex',
    gap: '3px',
    height: '4px',
    marginBlockStart: '2px',
    marginBlockEnd: '8px',
    marginInline: '10px',
  },
  sectionTitle: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const STATE_VISUALS = {
  done: { color: cssVar.colorSuccess, icon: CheckCircle2 },
  pending: { color: cssVar.colorTextQuaternary, icon: CircleSlash },
  running: { color: cssVar.colorInfo, icon: LoaderCircle, spin: true },
  waiting: { color: cssVar.colorWarning, icon: Clock3 },
} as const;

const WorkflowRow = memo<{ onOpen: () => void; row: GoalWorkflowRow }>(({ row, onOpen }) => {
  const visual = STATE_VISUALS[row.state];
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onOpen();
    },
    [onOpen],
  );
  return (
    <Flexbox
      horizontal
      align={'center'}
      {...stylex.props(styles.row)}
      gap={8}
      role={'button'}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      {row.assigneeId ? (
        <AssigneeProfileAvatar agentId={row.assigneeId} size={20} />
      ) : (
        <CircleSlash size={14} style={{ color: cssVar.colorTextQuaternary, flexShrink: 0 }} />
      )}
      <span
        style={{
          flex: 1,
          fontSize: 13,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.title}
      </span>
      <Icon
        icon={visual.icon}
        size={14}
        spin={'spin' in visual && visual.spin}
        style={{ color: visual.color, flexShrink: 0 }}
      />
    </Flexbox>
  );
});

WorkflowRow.displayName = 'GoalWorkflowRow';

const SEGMENT_CLASS = {
  active: styles.segActive,
  done: styles.segDone,
  pending: styles.segPending,
} as const;

/** The goal's actual flow — one segment per Task, same encoding as the message card. */
const StepTrack = memo<{ rows: GoalWorkflowRow[] }>(({ rows }) => {
  const segments = buildGoalStepSegments(toSegmentStatuses(rows));
  if (segments.length === 0) return null;

  return (
    <div aria-hidden {...stylex.props(styles.stepTrack)} data-testid={'goal-workflow-step-track'}>
      {segments.map((state, index) => (
        <div {...stylex.props(styles.segment, SEGMENT_CLASS[state])} key={index} />
      ))}
    </div>
  );
});

StepTrack.displayName = 'GoalWorkflowStepTrack';

/**
 * One conversation goal as a workflow card: the goal's own Tasks as a step
 * track and parallel rows with their assignees. The same pointer the
 * message-area card derives, read at topic scope — the sidebar is where
 * parallel state gets room to breathe.
 */
const GoalWorkflowCard = memo<{
  goal: GoalWorkflowView;
  /** Multi-goal topics keep only the newest card open by default. */
  initialCollapsed?: boolean;
}>(({ goal, initialCollapsed = false }) => {
  const { t } = useTranslation('chat');
  const openGoalPortal = useChatStore((s) => s.openGoal);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [rowsExpanded, setRowsExpanded] = useState(false);
  const bodyId = useId();

  const open = useCallback(() => openGoalPortal(goal.goalId), [goal.goalId, openGoalPortal]);
  const toggleCollapsed = useCallback(() => setCollapsed((prev) => !prev), []);
  const handleHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleCollapsed();
    },
    [toggleCollapsed],
  );

  const rows = sliceVisibleWorkflowRows(goal.rows, rowsExpanded);
  const hiddenCount = goal.rows.length - rows.length;
  const percent =
    goal.summary.total > 0 ? Math.round((goal.summary.done / goal.summary.total) * 100) : 0;
  // Without a snapshot there is no honest progress to show — no 0/0 placeholder.
  const hasSnapshot = !goal.loading && !goal.error;
  const title = goal.title || t('workingPanel.goal.title');

  return (
    <div>
      <Flexbox
        horizontal
        align={'center'}
        aria-controls={bodyId}
        aria-expanded={!collapsed}
        {...stylex.props(styles.headerRow)}
        gap={8}
        justify="space-between"
        role={'button'}
        tabIndex={0}
        onClick={toggleCollapsed}
        onKeyDown={handleHeaderKeyDown}
      >
        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 1, minWidth: 0 }}>
          <Icon icon={Workflow} size={14} style={{ color: cssVar.colorTextSecondary }} />
          <span {...stylex.props(styles.sectionTitle)} title={title}>
            {title}
          </span>
          {hasSnapshot && goal.phase !== 'running' && (
            <span {...stylex.props(styles.count)}>{t(`goalTask.status.${goal.phase}`)}</span>
          )}
          {hasSnapshot && (
            <span {...stylex.props(styles.count)}>
              {goal.summary.done}/{goal.summary.total}
            </span>
          )}
        </Flexbox>
        <Icon
          icon={collapsed ? ChevronDown : ChevronUp}
          size={14}
          style={{ color: cssVar.colorTextTertiary, flexShrink: 0 }}
        />
      </Flexbox>

      <div hidden={collapsed} id={bodyId}>
        {goal.error ? (
          <div {...stylex.props(styles.loading)}>
            <AsyncError error={goal.error} variant={'inline'} onRetry={goal.retry} />
          </div>
        ) : goal.loading ? (
          <Flexbox {...stylex.props(styles.loading)} data-testid={'goal-workflow-loading'} gap={8}>
            <Skeleton height={12} radius={4} />
            <Skeleton height={28} radius={6} />
            <Skeleton height={28} radius={6} />
          </Flexbox>
        ) : (
          <>
            <StepTrack rows={goal.rows} />

            {goal.pendingDecisions > 0 && (
              <Flexbox
                horizontal
                align={'center'}
                {...stylex.props(styles.decisionRow)}
                gap={6}
                justify={'space-between'}
                role={'button'}
                tabIndex={0}
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  open();
                }}
              >
                {t('workingPanel.goal.decision', { count: goal.pendingDecisions })}
                <ArrowUpRight size={13} />
              </Flexbox>
            )}

            <div style={{ paddingInline: 4 }}>
              {rows.map((row) => (
                <WorkflowRow key={row.id} row={row} onOpen={open} />
              ))}
              {hiddenCount > 0 ? (
                <Flexbox
                  horizontal
                  align={'center'}
                  {...stylex.props(styles.moreRow)}
                  gap={4}
                  role={'button'}
                  tabIndex={0}
                  onClick={() => setRowsExpanded(true)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setRowsExpanded(true);
                  }}
                >
                  {t('workingPanel.goal.more', { count: hiddenCount })}
                  <ChevronDown size={13} />
                </Flexbox>
              ) : (
                rowsExpanded &&
                goal.rows.length > MAX_VISIBLE_WORKFLOW_ROWS && (
                  <Flexbox
                    horizontal
                    align={'center'}
                    {...stylex.props(styles.lessRow)}
                    role={'button'}
                    tabIndex={0}
                    onClick={() => setRowsExpanded(false)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setRowsExpanded(false);
                    }}
                  >
                    {t('workingPanel.goal.collapse')}
                  </Flexbox>
                )
              )}
            </div>

            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.footer).className}
              gap={8}
            >
              <div {...stylex.props(styles.progress)}>
                <div {...sx([styles.progressFill], undefined, { width: `${percent}%` })} />
              </div>
              <Button outdent={'end'} size={'small'} type={'text'} onClick={open}>
                {t('workingPanel.goal.viewDetails')}
              </Button>
            </Flexbox>
          </>
        )}
      </div>
    </div>
  );
});

GoalWorkflowCard.displayName = 'GoalWorkflowCard';

const GoalWorkflowCardContainer = memo<{
  criteriaCount: number;
  goalId: string;
  initialCollapsed?: boolean;
  name: string;
}>(({ criteriaCount, goalId, initialCollapsed, name }) => {
  const view = useGoalWorkflow({ criteriaCount, goalId, name });
  return <GoalWorkflowCard goal={view} initialCollapsed={initialCollapsed} />;
});

GoalWorkflowCardContainer.displayName = 'GoalWorkflowCardContainer';

export { GoalWorkflowCard };
export default GoalWorkflowCardContainer;
