'use client';

import type { OperationGoal } from '@lobechat/builtin-tools/operationArtifacts';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatGoalCost } from '@/features/AgentGoals/GoalProgress';
import GoalStatusGlyph from '@/features/AgentGoals/GoalStatusGlyph';
import RunningGlyph from '@/features/Home/components/RunningGlyph';
import { useChatStore } from '@/store/chat';

import { buildGoalCardModel } from './goalCardModel';
import GoalElapsedTime from './GoalElapsedTime';
import type { GoalTaskPhase } from './goalTaskProgress';
import PlanChain from './PlanChain';
import StageTrack from './StageTrack';
import { useGoalTaskStatus } from './useGoalTaskStatus';

const ACTIVE_PHASES = new Set<GoalTaskPhase>(['planning', 'repairing', 'running', 'verifying']);

const styles = stylex.create({
  card: {
    cursor: 'pointer',
    width: '100%',
    paddingBlock: '12px',
    paddingInline: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: '10px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  chevron: { flexShrink: 0, color: cssVar.colorTextTertiary },
  meta: {
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
  },
  title: { minWidth: '0', fontSize: '14px', fontWeight: 500 },
});

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
      className={stylex.props(styles.card).className}
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
          <Text ellipsis className={stylex.props(styles.title).className} style={{ flex: 1 }}>
            {title ?? goal.name}
          </Text>
          <Text
            className={stylex.props(styles.meta).className}
            style={{ color: cssVar.colorTextSecondary }}
          >
            {t(`goalTask.status.${progress.phase}`)}
          </Text>
          {isActive && <GoalElapsedTime startedAt={startedAt} />}
          <ChevronRightIcon className={stylex.props(styles.chevron).className} size={16} />
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
                <span
                  className={stylex.props(styles.meta).className}
                  style={{ color: cssVar.colorWarning }}
                >
                  {t('goalList.needsYou', { count: model.needsYou })}
                </span>
              )}
              {model.taskTotal > 0 && (
                <span {...stylex.props(styles.meta)}>
                  {t('goalList.taskProgress', { done: model.taskDone, total: model.taskTotal })}
                </span>
              )}
              {model.findingCount > 0 && (
                <span {...stylex.props(styles.meta)}>
                  {t('goalList.findings', { count: model.findingCount })}
                </span>
              )}
              {model.totalCost > 0 && (
                <span {...stylex.props(styles.meta)}>{formatGoalCost(model.totalCost)}</span>
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
