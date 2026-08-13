'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRightIcon, TargetIcon } from 'lucide-react';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';

import type { OperationGoal } from './deriveOperationGoals';
import GoalStatusLine from './GoalStatusLine';
import { useGoalWorkStatus } from './useGoalWorkStatus';

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
  identifier: css`
    flex-shrink: 0;
    font-family: ${cssVar.fontFamilyCode};
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
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const { progress } = useGoalWorkStatus({
    criteriaCount: goal.criteriaCount,
    goalKnown: true,
    identifier: goal.identifier,
    maxRounds: goal.maxRounds,
    taskId: goal.taskId,
  });

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.card}
      gap={10}
      role={'button'}
      tabIndex={0}
      onClick={() => openTaskDetail(goal.identifier)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openTaskDetail(goal.identifier);
      }}
    >
      <Center className={styles.icon}>
        <Icon icon={TargetIcon} size={20} />
      </Center>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis className={styles.title}>
          {goal.name}
        </Text>
        <GoalStatusLine {...progress} />
      </Flexbox>
      <Text className={styles.identifier}>{goal.identifier}</Text>
      <ChevronRightIcon className={styles.chevron} size={16} />
    </Flexbox>
  );
});

GoalCard.displayName = 'GoalWorkCardItem';

const GoalWorkCard = memo<{ goals: OperationGoal[] }>(({ goals }) => {
  if (goals.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {goals.map((goal) => (
        <GoalCard goal={goal} key={goal.taskId} />
      ))}
    </Flexbox>
  );
});

GoalWorkCard.displayName = 'GoalWorkCard';

export default GoalWorkCard;
