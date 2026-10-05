'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
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

import {
  buildGoalStepSegments,
  type GoalWorkflowRow,
  MAX_VISIBLE_WORKFLOW_ROWS,
  sliceVisibleWorkflowRows,
  toSegmentStatuses,
} from './goalWorkflowView';
import { type GoalWorkflowView, useGoalWorkflow } from './useGoalSection';

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapsed: css`
    display: none;
  `,
  count: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  decisionRow: css`
    cursor: pointer;

    margin-block: 2px 6px;
    padding-block: 5px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorWarning};

    background: ${cssVar.colorWarningBg};

    &:hover {
      background: ${cssVar.colorWarningBorder};
    }
  `,
  footer: css`
    padding-block: 6px 2px;
  `,
  headerRow: css`
    cursor: pointer;
    user-select: none;

    padding-block: 4px 6px;
    padding-inline: 10px;
    border-radius: 6px;

    transition: background-color 0.12s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }
  `,
  lessRow: css`
    cursor: pointer;

    justify-content: center;

    padding-block: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  moreRow: css`
    cursor: pointer;

    justify-content: center;

    margin-block-start: 2px;
    padding-block: 5px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  progress: css`
    overflow: hidden;
    flex: 1;

    height: 4px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressFill: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorSuccess};
    transition: width 0.25s ${cssVar.motionEaseOut};
  `,
  row: css`
    cursor: pointer;
    padding-block: 5px;
    padding-inline: 8px;
    border-radius: 6px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: -2px;
    }
  `,
  loading: css`
    padding-block: 4px 8px;
    padding-inline: 10px;
  `,
  segActive: css`
    background: ${cssVar.colorInfo};
    animation: sidebar-goal-step-pulse 1.6s ${cssVar.motionEaseInOut} infinite;
  `,
  segDone: css`
    background: ${cssVar.colorSuccess};
  `,
  segPending: css`
    background: ${cssVar.colorFillSecondary};
  `,
  segment: css`
    flex: 1;
    height: 4px;
    border-radius: 2px;
  `,
  stepTrack: css`
    display: flex;
    gap: 3px;

    height: 4px;
    margin-block: 2px 8px;
    margin-inline: 10px;

    @keyframes sidebar-goal-step-pulse {
      0%,
      100% {
        opacity: 1;
      }

      50% {
        opacity: 0.45;
      }
    }
  `,
  sectionTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
      className={styles.row}
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
    <div aria-hidden className={styles.stepTrack} data-testid={'goal-workflow-step-track'}>
      {segments.map((state, index) => (
        <div className={cx(styles.segment, SEGMENT_CLASS[state])} key={index} />
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
        className={styles.headerRow}
        gap={8}
        justify="space-between"
        role={'button'}
        tabIndex={0}
        onClick={toggleCollapsed}
        onKeyDown={handleHeaderKeyDown}
      >
        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 1, minWidth: 0 }}>
          <Icon icon={Workflow} size={14} style={{ color: cssVar.colorTextSecondary }} />
          <span className={styles.sectionTitle} title={title}>
            {title}
          </span>
          {hasSnapshot && goal.phase !== 'running' && (
            <span className={styles.count}>{t(`goalTask.status.${goal.phase}`)}</span>
          )}
          {hasSnapshot && (
            <span className={styles.count}>
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

      <div className={cx(collapsed && styles.collapsed)} id={bodyId}>
        {goal.error ? (
          <div className={styles.loading}>
            <AsyncError error={goal.error} variant={'inline'} onRetry={goal.retry} />
          </div>
        ) : goal.loading ? (
          <Flexbox className={styles.loading} data-testid={'goal-workflow-loading'} gap={8}>
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
                className={styles.decisionRow}
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
                  className={styles.moreRow}
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
                    className={styles.lessRow}
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
              className={styles.footer}
              gap={8}
              style={{ paddingInline: 10 }}
            >
              <div className={styles.progress}>
                <div className={styles.progressFill} style={{ width: `${percent}%` }} />
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
