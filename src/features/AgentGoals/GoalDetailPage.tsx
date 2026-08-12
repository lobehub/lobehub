'use client';

import type { TaskDetailSubtask, TaskStatus } from '@lobechat/types';
import { Accordion, AccordionItem, Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { BadgeCheckIcon, BotIcon, CircleDashedIcon, RotateCcwIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import { useActiveTaskDetail } from '@/features/AgentTasks/AgentTaskDetail';
import TaskDetailTitleInput from '@/features/AgentTasks/AgentTaskDetail/TaskDetailTitleInput';
import TaskInstruction from '@/features/AgentTasks/AgentTaskDetail/TaskInstruction';
import TopicCard from '@/features/AgentTasks/AgentTaskDetail/TopicCard';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useNavigateToTaskDetail } from '@/features/AgentTasks/shared/taskDetailPath';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useVerifyStore, verifySelectors } from '@/store/verify';

import GoalDetailActions from './GoalDetailActions';
import { getGoalPresentation } from './goalPresentation';
import {
  formatGoalCost,
  formatGoalDuration,
  getGoalRunMetrics,
  getGoalRuns,
  getRecentGoalRuns,
  goalStatusToTaskStatus,
} from './goalViewModel';

const styles = createStaticStyles(({ css }) => ({
  acceptanceList: css`
    overflow: hidden;
    padding: 0;
  `,
  acceptanceRow: css`
    padding-block: 11px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  executionSection: css`
    padding-block: 18px;
  `,
  header: css`
    padding-block: 8px 4px;
  `,
  metric: css`
    min-width: 112px;

    & + & {
      padding-inline-start: 18px;
      border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  title: css`
    .ant-input {
      flex: none;
    }
  `,
  treeChildren: css`
    margin-inline-start: 13px;
    padding-inline-start: 20px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  treeRow: css`
    position: relative;
    min-height: 40px;
    padding-block: 8px;

    &::before {
      content: '';

      position: absolute;
      inset-block-start: 20px;
      inset-inline-start: -20px;

      width: 12px;
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

interface GoalDetailPageProps {
  agentId: string;
  goalId: string;
}

const statusVisual = (status: string) =>
  TASK_STATUS_VISUALS[status as TaskStatus] ?? TASK_STATUS_VISUALS.backlog;

const TaskTreeItem = memo<{ task: TaskDetailSubtask }>(({ task }) => {
  const navigateToTaskDetail = useNavigateToTaskDetail();
  const visual = statusVisual(task.status);
  const { text: updatedAt, title: updatedAtTitle } = useActivityTime(task.updatedAt);

  return (
    <Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.treeRow}
        gap={8}
        style={{ cursor: 'pointer' }}
        onClick={() => navigateToTaskDetail(task.identifier)}
      >
        <Icon color={visual.color} icon={visual.icon} size={14} />
        <Text fontSize={12} type={'secondary'}>
          {task.identifier}
        </Text>
        <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
          {task.name || task.identifier}
        </Text>
        <AssigneeAvatar agentId={task.assignee?.id} size={18} />
        <Text fontSize={12} title={updatedAtTitle} type={'secondary'}>
          {updatedAt || '—'}
        </Text>
      </Flexbox>
      {task.children && task.children.length > 0 && (
        <Flexbox className={styles.treeChildren}>
          <TaskTreeRows tasks={task.children} />
        </Flexbox>
      )}
    </Flexbox>
  );
});

TaskTreeItem.displayName = 'GoalTaskTreeItem';

const TaskTreeRows = memo<{ depth?: number; tasks: TaskDetailSubtask[] }>(({ tasks }) => {
  return tasks.map((item) => <TaskTreeItem key={item.identifier} task={item} />);
});

TaskTreeRows.displayName = 'GoalTaskTreeRows';

const GoalDetailPage = memo<GoalDetailPageProps>(({ agentId, goalId }) => {
  const { t } = useTranslation('chat');
  const navigateToTaskDetail = useNavigateToTaskDetail();
  const { error, isInitialLoading, isNotFound, onRetry } = useActiveTaskDetail(goalId);
  const task = useTaskStore(taskDetailSelectors.taskDetailById(goalId));
  const useFetchAcceptanceBySubject = useVerifyStore((s) => s.useFetchAcceptanceBySubject);
  const useFetchAcceptanceBundle = useVerifyStore((s) => s.useFetchAcceptanceBundle);
  const acceptance = useVerifyStore(verifySelectors.acceptanceBySubject('task', task?.id));
  const bundle = useVerifyStore(verifySelectors.acceptanceBundle(acceptance?.id));
  const acceptanceQuery = useFetchAcceptanceBySubject('task', task?.id);
  const bundleQuery = useFetchAcceptanceBundle(acceptance?.id);
  const config = task?.config as { goal?: { maxIterations?: number | null } } | undefined;
  const runs = useMemo(() => getGoalRuns(task?.activities), [task?.activities]);
  const recentRuns = useMemo(() => getRecentGoalRuns(task?.activities), [task?.activities]);
  const runMetrics = useMemo(() => getGoalRunMetrics(task?.activities), [task?.activities]);
  const { text: rootUpdatedAt, title: rootUpdatedAtTitle } = useActivityTime(task?.updatedAt);
  const presentation = getGoalPresentation({
    acceptanceStatus: bundle?.acceptance.status,
    checks: bundle?.checks,
    maxRounds: config?.goal?.maxIterations,
    rounds: task?.topicCount ?? 0,
    taskStatus: task?.status ?? 'backlog',
  });
  const visual = statusVisual(goalStatusToTaskStatus(presentation.statusKey));
  const title = task?.name?.trim() || task?.instruction.trim() || goalId;

  if (error) return <AsyncError error={error} variant={'page'} onRetry={onRetry} />;
  if (isNotFound)
    return (
      <NotFound desc={t('goalDetail.notFoundDescription')} title={t('goalDetail.notFoundTitle')} />
    );

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          <Flexbox horizontal align={'center'} gap={4}>
            <AgentBreadcrumb agentId={agentId} extraItems={[title]} title={t('goalList.title')} />
            <GoalDetailActions agentId={agentId} goalId={goalId} />
          </Flexbox>
        }
      />
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        <WideScreenContainer gap={20} paddingBlock={16}>
          {isInitialLoading || !task ? (
            <SurfaceSkeleton header={false} variant={'editor'} />
          ) : (
            <>
              <Flexbox className={styles.header} gap={8}>
                <Flexbox horizontal align={'flex-start'} gap={12}>
                  <Flexbox className={styles.title} gap={5} style={{ flex: 1, minWidth: 0 }}>
                    <TaskDetailTitleInput />
                    {task.description && (
                      <Text fontSize={15} style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                        {task.description}
                      </Text>
                    )}
                  </Flexbox>
                </Flexbox>

                <Flexbox horizontal gap={18} wrap={'wrap'}>
                  <Flexbox className={styles.metric} gap={2}>
                    <Flexbox horizontal align={'center'} gap={7}>
                      <Progress
                        percent={presentation.progress}
                        showInfo={false}
                        size={24}
                        strokeColor={cssVar.colorSuccess}
                        type={'circle'}
                      />
                      <Text fontSize={18} weight={600}>
                        {presentation.total > 0
                          ? `${presentation.passed}/${presentation.total}`
                          : '—'}
                      </Text>
                    </Flexbox>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalDetail.metrics.progress')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={18} weight={600}>
                      {task.topicCount ?? 0}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalDetail.metrics.taskExecutions')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={18} weight={600}>
                      {runs.length}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalDetail.metrics.agentRuns')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={18} weight={600}>
                      {formatGoalDuration(runMetrics.duration)}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalDetail.metrics.totalDuration')}
                    </Text>
                  </Flexbox>
                  <Flexbox className={styles.metric} gap={2}>
                    <Text fontSize={18} weight={600}>
                      {formatGoalCost(runMetrics.cost)}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('goalDetail.metrics.totalCost')}
                    </Text>
                  </Flexbox>
                </Flexbox>
                <Flexbox gap={4} paddingBlock={'8px 0'}>
                  <Text fontSize={12} type={'secondary'} weight={500}>
                    {t('goalDetail.instruction')}
                  </Text>
                  <TaskInstruction />
                </Flexbox>
              </Flexbox>

              <Flexbox gap={4}>
                <Accordion defaultExpandedKeys={['acceptance']} gap={0}>
                  <AccordionItem
                    itemKey={'acceptance'}
                    paddingBlock={6}
                    paddingInline={0}
                    title={
                      <Flexbox horizontal align={'center'} gap={8}>
                        <Text fontSize={14} weight={600}>
                          {t('goalDetail.acceptance')}
                        </Text>
                        {presentation.total > 0 && <Tag size={'small'}>{presentation.total}</Tag>}
                      </Flexbox>
                    }
                  >
                    <Flexbox paddingBlock={8}>
                      {acceptanceQuery.error || bundleQuery.error ? (
                        <AsyncError
                          error={acceptanceQuery.error || bundleQuery.error}
                          variant={'inline'}
                          onRetry={() => {
                            void acceptanceQuery.mutate();
                            if (acceptance?.id) void bundleQuery.mutate();
                          }}
                        />
                      ) : acceptanceQuery.isLoading || bundleQuery.isLoading ? (
                        <Text type={'secondary'}>{t('goalPage.loadingProgress')}</Text>
                      ) : presentation.total === 0 ? (
                        <Text type={'secondary'}>{t('goalDetail.noChecks')}</Text>
                      ) : (
                        <Block className={styles.acceptanceList} variant={'outlined'}>
                          {bundle?.checks.map((check, index) => {
                            const passed = check.state === 'passed';
                            const failed = check.state === 'failed';
                            return (
                              <Flexbox
                                horizontal
                                align={'center'}
                                className={styles.acceptanceRow}
                                gap={10}
                                key={check.id}
                              >
                                <Icon
                                  size={16}
                                  color={
                                    passed
                                      ? cssVar.colorSuccess
                                      : failed
                                        ? cssVar.colorError
                                        : cssVar.colorTextQuaternary
                                  }
                                  icon={
                                    passed
                                      ? BadgeCheckIcon
                                      : failed
                                        ? RotateCcwIcon
                                        : CircleDashedIcon
                                  }
                                />
                                <Text fontSize={12} type={'secondary'}>
                                  C{index + 1}
                                </Text>
                                <Text style={{ flex: 1 }}>{check.title}</Text>
                              </Flexbox>
                            );
                          })}
                        </Block>
                      )}
                    </Flexbox>
                  </AccordionItem>
                </Accordion>

                <Flexbox className={styles.executionSection} gap={12}>
                  <Flexbox gap={5}>
                    <Flexbox horizontal align={'center'} gap={8}>
                      <Text fontSize={14} weight={600}>
                        {t('goalDetail.executionOverview')}
                      </Text>
                      <Button
                        size={'small'}
                        type={'text'}
                        onClick={() => navigateToTaskDetail(task.identifier, agentId)}
                      >
                        {t('goalDetail.viewPlan')}
                      </Button>
                    </Flexbox>
                  </Flexbox>
                  <Flexbox gap={4}>
                    <Flexbox horizontal align={'center'} className={styles.treeRow} gap={8}>
                      <Icon color={visual.color} icon={visual.icon} size={14} />
                      <Text fontSize={12} type={'secondary'}>
                        {task.identifier}
                      </Text>
                      <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={600}>
                        {task.name || task.identifier}
                      </Text>
                      <AssigneeAvatar agentId={task.agentId} size={18} />
                      <Text fontSize={12} title={rootUpdatedAtTitle} type={'secondary'}>
                        {rootUpdatedAt || '—'}
                      </Text>
                    </Flexbox>
                    {task.subtasks && task.subtasks.length > 0 && (
                      <Flexbox className={styles.treeChildren}>
                        <TaskTreeRows tasks={task.subtasks} />
                      </Flexbox>
                    )}
                  </Flexbox>
                  <Flexbox horizontal align={'center'} gap={8} paddingBlock={'12px 0'}>
                    <Text fontSize={13} weight={600}>
                      {t('goalDetail.latestRuns')}
                    </Text>
                  </Flexbox>
                  {runs.length > 0 ? (
                    <Flexbox gap={12} paddingBlock={8}>
                      {recentRuns.map((activity, index) => (
                        <TopicCard
                          activity={activity}
                          key={activity.id || activity.topicId || index}
                        />
                      ))}
                    </Flexbox>
                  ) : (
                    <Flexbox
                      horizontal
                      align={'center'}
                      gap={8}
                      paddingBlock={10}
                      paddingInline={12}
                    >
                      <Icon color={cssVar.colorTextQuaternary} icon={BotIcon} size={15} />
                      <Text type={'secondary'}>{t('goalDetail.noRuns')}</Text>
                    </Flexbox>
                  )}
                </Flexbox>
              </Flexbox>
            </>
          )}
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

GoalDetailPage.displayName = 'GoalDetailPage';

export default GoalDetailPage;
