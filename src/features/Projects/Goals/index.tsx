'use client';

import { Block, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRightIcon, PlusIcon, TargetIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { createTaskModal } from '@/features/AgentTasks/CreateTaskModal';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';

const GOAL_STATUSES = [
  'backlog',
  'running',
  'scheduled',
  'paused',
  'completed',
  'failed',
  'canceled',
];

type GoalStatusKey =
  | 'goals.status.backlog'
  | 'goals.status.canceled'
  | 'goals.status.completed'
  | 'goals.status.failed'
  | 'goals.status.paused'
  | 'goals.status.running'
  | 'goals.status.scheduled';

const GOAL_STATUS_KEYS: Record<string, GoalStatusKey> = {
  backlog: 'goals.status.backlog',
  canceled: 'goals.status.canceled',
  completed: 'goals.status.completed',
  failed: 'goals.status.failed',
  paused: 'goals.status.paused',
  running: 'goals.status.running',
  scheduled: 'goals.status.scheduled',
};

const styles = createStaticStyles(({ css }) => ({
  item: css`
    transition: border-color 0.2s ${cssVar.motionEaseOut};

    &:hover {
      border-color: ${cssVar.colorPrimaryBorder};
    }
  `,
}));

const ProjectGoals = memo(() => {
  const { t } = useTranslation('project');
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { data, error, isLoading, mutate } = useClientDataSWR(
    projectId ? ['project/goals', projectId] : null,
    () =>
      taskService.groupList({
        groups: [{ key: 'goals', limit: 100, statuses: GOAL_STATUSES }],
        hasGoal: true,
        parentTaskId: null,
        projectId,
      }),
  );
  const goals = data?.data[0]?.tasks ?? [];
  const openCreateGoal = () =>
    createTaskModal({
      goal: true,
      projectId,
      showInlineToggle: false,
      onCreated: () => void mutate(),
    });

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={<Text weight={600}>{t('goals.title')}</Text>}
        right={
          <Button icon={PlusIcon} size={'small'} onClick={openCreateGoal}>
            {t('goals.create')}
          </Button>
        }
      />
      <WideScreenContainer
        flex={1}
        gap={16}
        paddingBlock={24}
        wrapperStyle={{ flex: 1, overflowY: 'auto' }}
      >
        <Flexbox gap={4}>
          <Text fontSize={24} weight={650}>
            {t('goals.title')}
          </Text>
          <Text type={'secondary'}>{t('goals.description')}</Text>
        </Flexbox>
        {isLoading ? (
          <Flexbox align={'center'} flex={1} justify={'center'}>
            <NeuralNetworkLoading />
          </Flexbox>
        ) : error ? (
          <Empty description={t('goals.loadError')}>
            <Button onClick={() => void mutate()}>{t('goals.retry')}</Button>
          </Empty>
        ) : goals.length === 0 ? (
          <Block padding={32} variant={'outlined'}>
            <Empty description={t('goals.emptyDescription')} title={t('goals.emptyTitle')}>
              <Button icon={PlusIcon} onClick={openCreateGoal}>
                {t('goals.create')}
              </Button>
            </Empty>
          </Block>
        ) : (
          <Flexbox gap={10}>
            {goals.map((goal) => (
              <Block
                clickable
                horizontal
                align={'center'}
                className={styles.item}
                gap={12}
                justify={'space-between'}
                key={goal.id}
                padding={16}
                variant={'outlined'}
                onClick={() =>
                  navigate(taskDetailPath(goal.identifier, goal.assigneeAgentId ?? undefined))
                }
              >
                <Flexbox horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
                  <Icon icon={TargetIcon} />
                  <Flexbox gap={2} style={{ minWidth: 0 }}>
                    <Text ellipsis weight={600}>
                      {goal.name || goal.instruction || goal.identifier}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {goal.identifier} ·{' '}
                      {t(GOAL_STATUS_KEYS[goal.status] ?? 'goals.status.backlog')}
                    </Text>
                  </Flexbox>
                </Flexbox>
                <Icon color={cssVar.colorTextQuaternary} icon={ArrowRightIcon} />
              </Block>
            ))}
          </Flexbox>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

ProjectGoals.displayName = 'ProjectGoals';

export default ProjectGoals;
