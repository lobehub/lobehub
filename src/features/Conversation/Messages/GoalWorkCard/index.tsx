'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleSlashIcon,
  Clock3Icon,
  LoaderCircleIcon,
  PauseCircleIcon,
  RefreshCwIcon,
  StampIcon,
  TargetIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceBundle, useAcceptanceBySubject } from '@/features/Verify';
import { useChatStore } from '@/store/chat';
import { useTaskStore } from '@/store/task';

import type { OperationGoal } from './deriveOperationGoals';
import { getGoalWorkProgress, type GoalWorkPhase } from './goalWorkProgress';

const PHASE_META = {
  achieved: { color: cssVar.colorSuccess, icon: CheckCircle2Icon, spin: false },
  canceled: { color: cssVar.colorTextTertiary, icon: CircleSlashIcon, spin: false },
  error: { color: cssVar.colorError, icon: AlertTriangleIcon, spin: false },
  paused: { color: cssVar.colorTextTertiary, icon: PauseCircleIcon, spin: false },
  repairing: { color: cssVar.colorWarning, icon: RefreshCwIcon, spin: true },
  review: { color: cssVar.colorWarning, icon: StampIcon, spin: false },
  running: { color: cssVar.colorInfo, icon: LoaderCircleIcon, spin: true },
  verifying: { color: cssVar.colorInfo, icon: LoaderCircleIcon, spin: true },
  waiting: { color: cssVar.colorTextSecondary, icon: Clock3Icon, spin: false },
} as const satisfies Record<
  GoalWorkPhase,
  { color: string; icon: typeof TargetIcon; spin: boolean }
>;

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
  progress: css`
    overflow: hidden;

    width: 72px;
    height: 3px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressFill: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorSuccess};
    transition: width 0.25s ease;
  `,
  statusIcon: css`
    flex-shrink: 0;
  `,
  status: css`
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
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  useFetchTaskDetail(goal.identifier);
  const task = useTaskStore((s) => s.taskDetailMap[goal.identifier]);
  const { data: acceptance } = useAcceptanceBySubject('task', goal.taskId);
  const { data: bundle } = useAcceptanceBundle(acceptance?.id ?? null);
  const config = task?.config as { goal?: { maxIterations?: number | null } } | undefined;
  const progress = getGoalWorkProgress({
    acceptanceStatus: acceptance?.status,
    checks: bundle?.checks,
    criteriaCount: goal.criteriaCount,
    maxRounds: config?.goal?.maxIterations ?? goal.maxRounds,
    rounds: task?.topicCount ?? 0,
    taskStatus: task?.status,
  });
  const phase = PHASE_META[progress.phase];

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
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon
            className={styles.statusIcon}
            color={phase.color}
            icon={phase.icon}
            size={12}
            spin={phase.spin}
          />
          <Text className={styles.status}>{t(`goalWork.status.${progress.phase}`)}</Text>
          <Text className={styles.status}>·</Text>
          <Text className={styles.status}>
            {progress.maxRounds
              ? t('goalWork.roundWithBudget', {
                  current: progress.round,
                  total: progress.maxRounds,
                })
              : t('goalWork.round', { current: progress.round })}
          </Text>
          {progress.total > 0 && (
            <>
              <Text className={styles.status}>·</Text>
              <div className={styles.progress}>
                <div className={styles.progressFill} style={{ width: `${progress.progress}%` }} />
              </div>
              <Text className={styles.status}>
                {t('goalWork.checks', { passed: progress.passed, total: progress.total })}
              </Text>
            </>
          )}
        </Flexbox>
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
