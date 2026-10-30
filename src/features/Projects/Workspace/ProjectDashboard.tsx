'use client';

import type { TaskStatus, WorkSummaryItem } from '@lobechat/types';
import { Block, Button, Center, Empty, Flexbox, Icon, Progress, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import { ArticleSkeleton } from '@/components/Skeleton';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import NavItem from '@/features/NavPanel/components/NavItem';
import {
  getProjectAcceptancePath,
  getProjectGoalsPath,
  getProjectSettingsPath,
  getProjectTasksPath,
} from '@/features/Projects/Layout/navigation';
import WorkSummaryCard from '@/features/Work/WorkSummaryCard';
import { useOpenWork } from '@/features/WorkGallery/useOpenWork';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { goalSelectors, useGoalStore } from '@/store/goal';
import type { ProjectDetail } from '@/store/project';
import { useWorkStore, workActions, workSelectors } from '@/store/work';

const styles = stylex.create({
  attention: {
    paddingBlock: '10px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: { 'default': 'minmax(0, 1fr) 300px', '@media (width <= 960px)': '1fr' },
    gap: '32px',
    alignItems: 'start',
    marginBlockStart: '40px',
  },
  goal: {
    paddingBlock: '12px',
    paddingInline: '14px',
    borderRadius: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  goalGrid: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(3, minmax(0, 1fr))',
      '@media (width <= 760px)': '1fr',
    },
    gap: '10px',
  },
  main: { minWidth: '0' },
  progress: {
    padding: '18px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 84%, ${cssVar.colorFillQuaternary})`,
    backgroundImage: 'none',
  },
  rail: { position: 'sticky', insetBlockStart: '24px', minWidth: '0' },
  railCard: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 78%, transparent)`,
    backgroundImage: 'none',
  },
  summaryLink: {
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    marginInline: '-6px',
    paddingBlock: '2px',
    paddingInline: '6px',
    borderStyle: 'none',
    borderRadius: '6px',
    font: 'inherit',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
      ':focus-visible': cssVar.colorFillTertiary,
    },
    backgroundImage: 'none',
  },
  section: {
    paddingBlock: '18px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  works: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(2, minmax(0, 1fr))',
      '@media (width <= 760px)': '1fr',
    },
    gap: '10px',
  },
});

const TERMINAL_STATUSES = new Set<TaskStatus | string>(['canceled', 'completed']);
const EMPTY_WORKS: WorkSummaryItem[] = [];
const ATTENTION_STATUSES = new Set<TaskStatus | string>(['failed', 'paused']);
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
  const goalListView = useGoalStore(goalSelectors.goalListView(goalScope));
  const goalSWR = useGoalStore((s) => s.useFetchGoals)(undefined, projectId);
  const coordinatorAgentId = detail.project.coordinatorAgentId;
  const projectReference = detail.project.slug ?? projectId;
  const agentWorksParams = useMemo(
    () => (coordinatorAgentId ? { originAgentId: coordinatorAgentId, workspaceId } : null),
    [coordinatorAgentId, workspaceId],
  );
  const workSync = workActions.useFetchAgentWorks(agentWorksParams);
  // `undefined` while nothing is painted yet; the stored copy paints first.
  const storedWorks = useWorkStore(workSelectors.agentWorks(coordinatorAgentId));

  const tasks = detail.tasks ?? [];
  const activeTasks = tasks.filter((task) => !TERMINAL_STATUSES.has(task.status)).slice(0, 5);
  const attentionTasks = tasks.filter((task) => ATTENTION_STATUSES.has(task.status)).slice(0, 3);
  const completedGoals = goals.filter(({ goal }) => goal.status === 'achieved').length;
  const progress = goals.length ? Math.round((completedGoals / goals.length) * 100) : 0;
  const works = storedWorks ?? EMPTY_WORKS;
  const worksPending = !!coordinatorAgentId && storedWorks === undefined;
  const goalPreview = useMemo(() => goals.slice(0, 3), [goals]);

  return (
    <div {...stylex.props(styles.columns)}>
      <Flexbox className={stylex.props(styles.main).className} gap={24}>
        <Flexbox gap={12}>
          <SectionTitle title={t('overview.goalProgress')} />
          {goalSWR.error && goalListView === undefined ? (
            <AsyncError
              error={goalSWR.error}
              variant={'inline'}
              onRetry={() => void goalSWR.mutate()}
            />
          ) : goalSWR.isLoading ? (
            <ArticleSkeleton rows={4} />
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
            <Flexbox className={stylex.props(styles.progress).className} gap={16}>
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
              <div {...stylex.props(styles.goalGrid)}>
                {goalPreview.map(({ goal }) => (
                  <Flexbox className={stylex.props(styles.goal).className} gap={5} key={goal.id}>
                    <Flexbox horizontal align={'center'} gap={6}>
                      <Icon
                        color={goal.status === 'achieved' ? cssVar.colorSuccess : undefined}
                        icon={goal.status === 'achieved' ? CheckCircle2Icon : CircleDotIcon}
                        size={15}
                      />
                      <Text ellipsis weight={500}>
                        {goal.title}
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

        <Flexbox className={stylex.props(styles.section).className} gap={8}>
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
                onClick={() => navigate(taskDetailPath(task.identifier, undefined, task.name))}
              />
            ))
          )}
        </Flexbox>

        <Flexbox className={stylex.props(styles.section).className} gap={12}>
          <SectionTitle count={works.length} title={t('overview.latestWorks')} />
          {workSync.error && worksPending ? (
            <AsyncError
              error={workSync.error}
              variant={'inline'}
              onRetry={() => void workSync.revalidate()}
            />
          ) : worksPending ? (
            // Before the stored copy is read, paint nothing rather than a
            // skeleton that the cached cards replace a frame later.
            workSync.isHydrated && <ArticleSkeleton rows={4} />
          ) : works.length === 0 ? (
            <Empty
              description={t('overview.worksEmptyDescription')}
              icon={PackageOpenIcon}
              title={t('overview.worksEmptyTitle')}
            />
          ) : (
            <div {...stylex.props(styles.works)}>
              {works.map((work: WorkSummaryItem) => (
                <WorkSummaryCard item={work} key={work.id} onOpen={openWork} />
              ))}
            </div>
          )}
        </Flexbox>
      </Flexbox>

      <Flexbox className={stylex.props(styles.rail).className} gap={16}>
        <Flexbox className={stylex.props(styles.railCard).className} gap={12}>
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
              <Flexbox className={stylex.props(styles.attention).className} gap={4} key={task.id}>
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

        <Flexbox className={stylex.props(styles.railCard).className} gap={12}>
          <SectionTitle title={t('overview.projectSummary')} />
          <Flexbox horizontal justify={'space-between'}>
            <Text type={'secondary'}>{t('sections.goals')}</Text>
            <Text>{goals.length}</Text>
          </Flexbox>
          <Flexbox horizontal justify={'space-between'}>
            <Text type={'secondary'}>{t('sections.tasks')}</Text>
            <Text>{tasks.length}</Text>
          </Flexbox>
          <button
            className={stylex.props(styles.summaryLink).className}
            type={'button'}
            onClick={() => navigate(getProjectSettingsPath(projectReference, 'members'))}
          >
            <Text type={'secondary'}>{t('sections.agents')}</Text>
            <Text>{detail.agents?.length ?? 0}</Text>
          </button>
          <button
            className={stylex.props(styles.summaryLink).className}
            type={'button'}
            onClick={() => navigate(getProjectSettingsPath(projectReference, 'knowledge'))}
          >
            <Text type={'secondary'}>{t('sections.knowledgeBases')}</Text>
            <Text>{detail.knowledgeBases?.length ?? 0}</Text>
          </button>
        </Flexbox>
      </Flexbox>
    </div>
  );
});

ProjectDashboard.displayName = 'ProjectDashboard';

export default ProjectDashboard;
