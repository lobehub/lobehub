'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRightIcon, CornerDownRightIcon, TargetIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import RingLoadingIcon from '@/components/RingLoading';
import { useChatStore } from '@/store/chat';

import type { OperationGoal } from './deriveOperationGoals';
import GoalElapsedTime from './GoalElapsedTime';
import GoalStatusLine from './GoalStatusLine';
import type { GoalTaskPhase } from './goalTaskProgress';
import { getGoalStepPointer } from './goalTaskProgress';
import { useGoalTaskStatus } from './useGoalTaskStatus';

const ACTIVE_PHASES = new Set<GoalTaskPhase>(['repairing', 'running', 'verifying']);

const styles = createStaticStyles(({ css }) => ({
  card: css`
    cursor: pointer;

    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgElevated};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  icon: css`
    flex-shrink: 0;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  stepIcon: css`
    flex-shrink: 0;
  `,
  stepLine: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
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
  const { progress, startedAt, steps, title } = useGoalTaskStatus({
    criteriaCount: goal.criteriaCount,
    goalId: goal.goalId,
  });
  const isActive = ACTIVE_PHASES.has(progress.phase);
  const stepPointer = getGoalStepPointer(steps, progress.phase);
  // Same destination as the tool card: the goal's progress beside the chat.
  const openGoal = () => openGoalPortal(goal.goalId);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.card}
      gap={10}
      role={'button'}
      tabIndex={0}
      onClick={openGoal}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openGoal();
      }}
    >
      <Center className={styles.icon}>
        {isActive ? (
          <RingLoadingIcon
            ringColor={cssVar.colorBorder}
            size={18}
            style={{ color: cssVar.colorWarning }}
          />
        ) : (
          <Icon icon={TargetIcon} size={20} />
        )}
      </Center>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis className={styles.title}>
          {title ?? goal.name}
        </Text>
        <GoalStatusLine
          passed={progress.passed}
          phase={progress.phase}
          statuses={steps.map((step) => step.status)}
          total={progress.total}
        />
        {stepPointer && (
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon
              className={styles.stepIcon}
              color={cssVar.colorTextTertiary}
              icon={CornerDownRightIcon}
              size={12}
            />
            <Text ellipsis className={styles.stepLine}>
              {t(`goalTask.${stepPointer.kind}Step`, { title: stepPointer.title })}
            </Text>
          </Flexbox>
        )}
      </Flexbox>
      {isActive && <GoalElapsedTime startedAt={startedAt} />}
      <ChevronRightIcon className={styles.chevron} size={16} />
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
