'use client';

import { Center, Empty, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { BlocksIcon, LayoutDashboardIcon, PlusIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { openCreateDashboardModal } from '@/features/Dashboard/DashboardFormModal';
import DashboardListCard, {
  dashboardListStyles,
} from '@/features/Dashboard/List/DashboardListCard';
import DashboardWidgetGrid from '@/features/Dashboard/WidgetGrid';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useProjectStore } from '@/store/project';

import { getProjectDashboardPath } from '../Layout/navigation';

const Section = ({ children, title }: { children: ReactNode; title: string }) => (
  <Flexbox gap={12}>
    <Text weight={500}>{title}</Text>
    {children}
  </Flexbox>
);

/** The project's boards, whoever in the project created them, and creating one here. */
const ProjectBoards = memo<{ onCreate: () => void; projectId: string }>(
  ({ onCreate, projectId }) => {
    const { t } = useTranslation('dashboard');
    const useFetchProjectDashboards = useDashboardStore((s) => s.useFetchProjectDashboards);
    const { data, error, isLoading, mutate } = useFetchProjectDashboards(projectId);
    const dashboards = useDashboardStore(dashboardSelectors.projectDashboards(projectId));

    return (
      <Section title={t('project.boards')}>
        <AsyncBoundary
          data={data}
          error={error}
          isEmpty={data?.length === 0}
          isLoading={isLoading}
          loading={<SkeletonList rows={2} />}
          empty={
            <Center gap={12} padding={24}>
              <Empty description={t('project.boardsEmpty')} icon={LayoutDashboardIcon} />
              <Button icon={PlusIcon} onClick={onCreate}>
                {t('create.action')}
              </Button>
            </Center>
          }
          onRetry={() => void mutate()}
        >
          <div data-project-dashboards className={dashboardListStyles.grid}>
            {dashboards.map((dashboard) => (
              <DashboardListCard
                dashboard={dashboard}
                href={getProjectDashboardPath(projectId, dashboard.id)}
                key={dashboard.id}
                level={{ projectId }}
              />
            ))}
          </div>
        </AsyncBoundary>
      </Section>
    );
  },
);

ProjectBoards.displayName = 'ProjectBoards';

/** Every widget of the project — including ones an agent built in a project conversation. */
const ProjectWidgets = memo<{ projectId: string }>(({ projectId }) => {
  const { t } = useTranslation('dashboard');
  const useFetchProjectWidgets = useDashboardStore((s) => s.useFetchProjectWidgets);
  const { data, error, isLoading, mutate } = useFetchProjectWidgets(projectId);
  const widgets = useDashboardStore(dashboardSelectors.projectWidgets(projectId));

  return (
    <Section title={t('project.widgets', { count: widgets.length })}>
      <AsyncBoundary
        data={data}
        error={error}
        isEmpty={data?.length === 0}
        isLoading={isLoading}
        loading={<SkeletonList rows={2} />}
        empty={
          <Center padding={24}>
            <Empty description={t('project.widgetsEmpty')} icon={BlocksIcon} />
          </Center>
        }
        onRetry={() => void mutate()}
      >
        <DashboardWidgetGrid widgets={widgets} />
      </AsyncBoundary>
    </Section>
  );
});

ProjectWidgets.displayName = 'ProjectWidgets';

const ProjectDashboardsPage = memo<{ projectId: string }>(({ projectId }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useWorkspaceAwareNavigate();

  const handleCreate = () =>
    openCreateDashboardModal({
      level: { projectId },
      onCreated: (dashboard) => navigate(getProjectDashboardPath(projectId, dashboard.id)),
    });

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          <Text style={{ paddingInlineStart: 4 }} weight={500}>
            {t('list.title')}
          </Text>
        }
      />
      <WideScreenContainer gap={24} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Text type={'secondary'}>{t('project.description')}</Text>
          <Button data-dashboard-create icon={PlusIcon} type={'primary'} onClick={handleCreate}>
            {t('create.action')}
          </Button>
        </Flexbox>
        <ProjectBoards projectId={projectId} onCreate={handleCreate} />
        <ProjectWidgets projectId={projectId} />
      </WideScreenContainer>
    </Flexbox>
  );
});

ProjectDashboardsPage.displayName = 'ProjectDashboardsPage';

/** `project/:projectId/dashboard` — the project's own boards and widgets. */
const ProjectDashboards = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const { data, error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectDetail)(
    projectId,
  );

  if (isLoading && !data) return <RouteLoading />;
  if (error && !data)
    return <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />;
  if (!data) return null;

  return <ProjectDashboardsPage projectId={data.data.project.id} />;
};

export default ProjectDashboards;
