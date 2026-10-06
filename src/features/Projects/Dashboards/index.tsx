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
import { dashboardPageStyles as pageStyles } from '@/features/Dashboard/pageStyles';
import DashboardWidgetGrid from '@/features/Dashboard/WidgetGrid';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { getProjectDashboardPath } from '../Layout/navigation';

const Section = ({ children, title }: { children: ReactNode; title: string }) => (
  <Flexbox gap={12}>
    <h2 className={pageStyles.sectionTitle}>{title}</h2>
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
      <div className={pageStyles.scroll}>
        <div className={pageStyles.canvas} style={{ gap: 32 }}>
          <Flexbox
            horizontal
            align={'flex-end'}
            className={pageStyles.heading}
            gap={16}
            justify={'space-between'}
          >
            <Flexbox gap={6} style={{ minWidth: 0 }}>
              <h1 className={pageStyles.title}>{t('list.title')}</h1>
              <Text className={pageStyles.description}>{t('project.description')}</Text>
            </Flexbox>
            <Button
              data-dashboard-create
              icon={PlusIcon}
              style={{ flex: 'none' }}
              type={'primary'}
              onClick={handleCreate}
            >
              {t('create.action')}
            </Button>
          </Flexbox>
          <ProjectBoards projectId={projectId} onCreate={handleCreate} />
          <ProjectWidgets projectId={projectId} />
        </div>
      </div>
    </Flexbox>
  );
});

ProjectDashboardsPage.displayName = 'ProjectDashboardsPage';

/** `project/:projectId/dashboard` — the project's own boards and widgets. */
const ProjectDashboards = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const { error, isHydrated, isValidating, revalidate } = useProjectStore(
    (s) => s.useFetchProjectDetail,
  )(projectId);

  if (!detail && (!isHydrated || isValidating)) return <RouteLoading />;
  if (error && !detail)
    return <AsyncError error={error} variant={'page'} onRetry={() => void revalidate()} />;
  if (!detail) return null;

  return <ProjectDashboardsPage projectId={detail.project.id} />;
};

export default ProjectDashboards;
