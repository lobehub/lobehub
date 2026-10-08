'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRightIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatGoalCost } from '@/features/AgentGoals/GoalProgress';
import GoalStatusGlyph from '@/features/AgentGoals/GoalStatusGlyph';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useChatStore } from '@/store/chat';

import type { OperationGoal } from './deriveOperationGoals';
import { buildGoalCardModel } from './goalCardModel';
import GoalElapsedTime from './GoalElapsedTime';
import type { GoalTaskPhase } from './goalTaskProgress';
import PlanChain from './PlanChain';
import StageTrack from './StageTrack';
import { useGoalTaskStatus } from './useGoalTaskStatus';

const ACTIVE_PHASES = new Set<GoalTaskPhase>(['planning', 'repairing', 'running', 'verifying']);

const styles = createStaticStyles(({ css }) => ({
  card: css`
    cursor: pointer;

    width: 100%;
    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    background: ${cssVar.colorBgElevated};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  meta: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  title: css`
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
  `,
}));

const GoalCard = memo<{ goal: OperationGoal }>(({ goal }) => {
  const { t } = useTranslation('chat');
  const openGoalPortal = useChatStore((s) => s.openGoal);
  const { progress, snapshot, startedAt, title } = useGoalTaskStatus({
    criteriaCount: goal.criteriaCount,
    goalId: goal.goalId,
  });
  const model = useMemo(() => (snapshot ? buildGoalCardModel(snapshot) : undefined), [snapshot]);
  const isActive = ACTIVE_PHASES.has(progress.phase);
  const requirement = snapshot?.goal.requirement?.trim();
  // Same destination as the tool card: the goal's progress beside the chat.
  const openGoal = () => openGoalPortal(goal.goalId);

  return (
    <Flexbox
      className={styles.card}
      gap={12}
      role={'button'}
      tabIndex={0}
      onClick={openGoal}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openGoal();
      }}
    >
      <Flexbox gap={2}>
        <Flexbox horizontal align={'center'} gap={8}>
          {isActive || !snapshot ? (
            <RunningGlyph size={14} />
          ) : (
            <GoalStatusGlyph size={14} status={snapshot.goal.status} />
          )}
          <Text ellipsis className={styles.title} style={{ flex: 1 }}>
            {title ?? goal.name}
          </Text>
          <Text className={styles.meta} style={{ color: cssVar.colorTextSecondary }}>
            {t(`goalTask.status.${progress.phase}`)}
          </Text>
          {isActive && <GoalElapsedTime startedAt={startedAt} />}
          <ChevronRightIcon className={styles.chevron} size={16} />
        </Flexbox>
        {requirement && requirement !== (title ?? goal.name) && (
          <Text ellipsis fontSize={12} style={{ paddingInlineStart: 22 }} type={'secondary'}>
            {requirement}
          </Text>
        )}
      </Flexbox>
      {model && (
        <>
          <StageTrack stage={model.stage} tone={model.tone} />
          <PlanChain model={model} />
          {(model.taskTotal > 0 || model.needsYou > 0 || model.totalCost > 0) && (
            <Flexbox horizontal align={'center'} gap={12}>
              {model.needsYou > 0 && (
                <span className={styles.meta} style={{ color: cssVar.colorWarning }}>
                  {t('goalList.needsYou', { count: model.needsYou })}
                </span>
              )}
              {model.taskTotal > 0 && (
                <span className={styles.meta}>
                  {t('goalList.taskProgress', { done: model.taskDone, total: model.taskTotal })}
                </span>
              )}
              {model.findingCount > 0 && (
                <span className={styles.meta}>
                  {t('goalList.findings', { count: model.findingCount })}
                </span>
              )}
              {model.totalCost > 0 && (
                <span className={styles.meta}>{formatGoalCost(model.totalCost)}</span>
              )}
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
});

GoalCard.displayName = 'GoalTaskCardItem';

const GoalTaskCard = memo<{ goals: OperationGoal[] }>(({ goals }) => {
  if (goals.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {goals.map((goal) => (
        <GoalCard goal={goal} key={goal.goalId} />
      ))}
    </Flexbox>
  );
});

GoalTaskCard.displayName = 'GoalTaskCard';

export default GoalTaskCard;
