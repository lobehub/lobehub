'use client';

import type { TaskStatus, WorkSummaryItem } from '@lobechat/types';
import { Block, Center, Empty, Flexbox, Icon, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  BadgeCheckIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  Clock3Icon,
  PackageOpenIcon,
  TargetIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import NavItem from '@/features/NavPanel/components/NavItem';
import {
  getProjectAcceptancePath,
  getProjectGoalsPath,
  getProjectTasksPath,
} from '@/features/Projects/Layout/navigation';
import WorkSummaryCard from '@/features/Work/WorkSummaryCard';
import { useOpenWork } from '@/features/WorkGallery/useOpenWork';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { workKeys } from '@/libs/swr/keys';
import { workService } from '@/services/work';
import { goalSelectors, useGoalStore } from '@/store/goal';
import type { ProjectDetail } from '@/store/project';

const styles = createStaticStyles(({ css }) => ({
  attention: css`
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }
  `,
  columns: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 32px;
    align-items: start;

    margin-block-start: 40px;

    @media (width <= 960px) {
      grid-template-columns: 1fr;
    }
  `,
  goal: css`
    padding-block: 12px;
    padding-inline: 14px;
    border-radius: 12px;
    background: ${cssVar.colorFillQuaternary};
  `,
  goalGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;

    @media (width <= 760px) {
      grid-template-columns: 1fr;
    }
  `,
  main: css`
    min-width: 0;
  `,
  progress: css`
    padding: 18px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;
    background: color-mix(in srgb, ${cssVar.colorBgContainer} 84%, ${cssVar.colorFillQuaternary});
  `,
  rail: css`
    position: sticky;
    inset-block-start: 24px;
    min-width: 0;
  `,
  railCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;
    background: color-mix(in srgb, ${cssVar.colorBgContainer} 78%, transparent);
  `,
  section: css`
    padding-block: 18px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  works: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;

    @media (width <= 760px) {
      grid-template-columns: 1fr;
    }
  `,
}));

const TERMINAL_STATUSES = new Set<TaskStatus | string>(['canceled', 'completed']);
const ATTENTION_STATUSES = new Set<TaskStatus | string>(['failed', 'paused']);
const isGoalTask = (task: NonNullable<ProjectDetail['tasks']>[number]) => Boolean(task.goal);

interface ProjectDashboardProps {
  detail: ProjectDetail;
  projectId: string;
}

const SectionTitle = memo<{
  action?: string;
  count?: number;
  onAction?: () => void;
  title: string;
}>(({ action, count, onAction, title }) => (
  <Flexbox horizontal align={'center'} justify={'space-between'}>
    <Flexbox horizontal align={'center'} gap={7}>
      <Text fontSize={16} weight={600}>
        {title}
      </Text>
      {count !== undefined && <Tag>{count}</Tag>}
    </Flexbox>
    {action && (
      <Button size={'small'} type={'text'} onClick={onAction}>
        {action}
      </Button>
    )}
  </Flexbox>
));

const ProjectDashboard = memo<ProjectDashboardProps>(({ detail, projectId }) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const openWork = useOpenWork();
  const workspaceId = useActiveWorkspaceId();
  const goalScope = `project:${projectId}`;
  const goals = useGoalStore(goalSelectors.goalList(goalScope));
  const goalSWR = useGoalStore((s) => s.useFetchGoals)(undefined, projectId);
  const coordinatorAgentId = detail.project.coordinatorAgentId;
  const projectReference = detail.project.slug ?? projectId;
  const workSWR = useClientDataSWR(
    coordinatorAgentId
      ? workKeys.workspace(workspaceId, `project:${projectId}:${coordinatorAgentId}`)
      : null,
    () =>
      workService.listByWorkspace({
        limit: 4,
        originAgentId: coordinatorAgentId,
      }),
  );

  const tasks = (detail.tasks ?? []).filter((task) => !isGoalTask(task));
  const activeTasks = tasks.filter((task) => !TERMINAL_STATUSES.has(task.status)).slice(0, 5);
  const attentionTasks = tasks.filter((task) => ATTENTION_STATUSES.has(task.status)).slice(0, 3);
  const completedGoals = goals.filter((goal) => goal.status === 'completed').length;
  const progress = goals.length ? Math.round((completedGoals / goals.length) * 100) : 0;
  const works = workSWR.data?.items ?? [];
  const goalPreview = useMemo(() => goals.slice(0, 3), [goals]);

  return (
    <div className={styles.columns}>
      <Flexbox className={styles.main} gap={24}>
        <Flexbox gap={12}>
          <SectionTitle title={t('overview.goalProgress')} />
          {goalSWR.error ? (
            <AsyncError
              error={goalSWR.error}
              variant={'inline'}
              onRetry={() => void goalSWR.mutate()}
            />
          ) : goalSWR.isLoading && goals.length === 0 ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : goals.length === 0 ? (
            <Block padding={24} variant={'outlined'}>
              <Center gap={10}>
                <Icon icon={TargetIcon} size={24} />
                <Text type={'secondary'}>{t('overview.goalsEmpty')}</Text>
                <Button onClick={() => navigate(getProjectGoalsPath(projectReference))}>
                  {t('goals.create')}
                </Button>
              </Center>
            </Block>
          ) : (
            <Flexbox className={styles.progress} gap={16}>
              <Flexbox horizontal align={'flex-start'} justify={'space-between'}>
                <Flexbox gap={4}>
                  <Text weight={600}>{t('overview.goalSummary')}</Text>
                  <Text fontSize={13} type={'secondary'}>
                    {t('overview.goalCount', { completed: completedGoals, total: goals.length })}
                  </Text>
                </Flexbox>
                <Text fontSize={22} weight={650}>
                  {progress}%
                </Text>
              </Flexbox>
              <Progress percent={progress} showInfo={false} />
              <div className={styles.goalGrid}>
                {goalPreview.map((goal) => (
                  <Flexbox className={styles.goal} gap={5} key={goal.id}>
                    <Flexbox horizontal align={'center'} gap={6}>
                      <Icon
                        color={goal.status === 'completed' ? cssVar.colorSuccess : undefined}
                        icon={goal.status === 'completed' ? CheckCircle2Icon : CircleDotIcon}
                        size={15}
                      />
                      <Text ellipsis weight={500}>
                        {goal.name || goal.instruction}
                      </Text>
                    </Flexbox>
                    <Text fontSize={12} type={'secondary'}>
                      {t(`goals.status.${goal.status}`, { defaultValue: goal.status })}
                    </Text>
                  </Flexbox>
                ))}
              </div>
            </Flexbox>
          )}
        </Flexbox>

        <Flexbox className={styles.section} gap={8}>
          <SectionTitle
            action={t('overview.viewAllTasks')}
            count={activeTasks.length}
            title={t('overview.activeTasks')}
            onAction={() => navigate(getProjectTasksPath(projectReference))}
          />
          {activeTasks.length === 0 ? (
            <Text style={{ paddingBlock: 16 }} type={'secondary'}>
              {t('overview.noActiveTasks')}
            </Text>
          ) : (
            activeTasks.map((task) => (
              <NavItem
                description={task.description || task.instruction}
                icon={task.status === 'paused' ? Clock3Icon : CircleDotIcon}
                key={task.id}
                title={task.name || task.instruction}
                extra={
                  <Tag size={'small'}>
                    {t(`goals.status.${task.status}`, { defaultValue: task.status })}
                  </Tag>
                }
                onClick={() => navigate(`/task/${task.id}`)}
              />
            ))
          )}
        </Flexbox>

        <Flexbox className={styles.section} gap={12}>
          <SectionTitle count={works.length} title={t('overview.latestWorks')} />
          {workSWR.error ? (
            <AsyncError
              error={workSWR.error}
              variant={'inline'}
              onRetry={() => void workSWR.mutate()}
            />
          ) : workSWR.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : works.length === 0 ? (
            <Empty
              description={t('overview.worksEmptyDescription')}
              icon={PackageOpenIcon}
              title={t('overview.worksEmptyTitle')}
            />
          ) : (
            <div className={styles.works}>
              {works.map((work: WorkSummaryItem) => (
                <WorkSummaryCard item={work} key={work.id} onOpen={openWork} />
              ))}
            </div>
          )}
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.rail} gap={16}>
        <Flexbox className={styles.railCard} gap={12}>
          <SectionTitle count={attentionTasks.length} title={t('overview.needsAttention')} />
          {attentionTasks.length === 0 ? (
            <Flexbox align={'center'} gap={8} paddingBlock={12}>
              <Icon color={cssVar.colorSuccess} icon={BadgeCheckIcon} size={22} />
              <Text fontSize={13} type={'secondary'}>
                {t('overview.nothingNeedsAttention')}
              </Text>
            </Flexbox>
          ) : (
            attentionTasks.map((task) => (
              <Flexbox className={styles.attention} gap={4} key={task.id}>
                <Text weight={500}>{task.name || task.instruction}</Text>
                <Text fontSize={12} type={task.status === 'failed' ? 'danger' : 'secondary'}>
                  {task.status === 'failed' ? t('overview.taskFailed') : t('overview.taskWaiting')}
                </Text>
              </Flexbox>
            ))
          )}
          {detail.project.status === 'reviewing' && (
            <Button
              icon={TriangleAlertIcon}
              onClick={() => navigate(getProjectAcceptancePath(projectReference))}
            >
              {t('overview.reviewProject')}
            </Button>
          )}
        </Flexbox>

        <Flexbox className={styles.railCard} gap={12}>
          <SectionTitle title={t('overview.projectSummary')} />
          <Flexbox horizontal justify={'space-between'}>
            <Text type={'secondary'}>{t('sections.goals')}</Text>
            <Text>{goals.length}</Text>
          </Flexbox>
          <Flexbox horizontal justify={'space-between'}>
            <Text type={'secondary'}>{t('sections.tasks')}</Text>
            <Text>{tasks.length}</Text>
          </Flexbox>
          <Flexbox horizontal justify={'space-between'}>
            <Text type={'secondary'}>{t('sections.agents')}</Text>
            <Text>{detail.agents?.length ?? 0}</Text>
          </Flexbox>
          <Flexbox horizontal justify={'space-between'}>
            <Text type={'secondary'}>{t('sections.knowledgeBases')}</Text>
            <Text>{detail.knowledgeBases?.length ?? 0}</Text>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </div>
  );
});

ProjectDashboard.displayName = 'ProjectDashboard';

export default ProjectDashboard;
