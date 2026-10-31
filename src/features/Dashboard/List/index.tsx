'use client';

import { Button, Center, Empty, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { LayoutDashboardIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { openCreateDashboardModal } from '../DashboardFormModal';
import { dashboardPageStyles as pageStyles } from '../pageStyles';
import DashboardListCard, { dashboardListStyles } from './DashboardListCard';

/** Home: the personal boards (no workspace / project / agent) and creating one. */
const DashboardListPage = memo(() => {
  const { t } = useTranslation('dashboard');
  const navigate = useWorkspaceAwareNavigate();
  const useFetchDashboards = useDashboardStore((s) => s.useFetchDashboards);
  const { data, error, isLoading, mutate } = useFetchDashboards();
  const dashboards = useDashboardStore(dashboardSelectors.dashboardList());

  const handleCreate = () =>
    openCreateDashboardModal({
      onCreated: (dashboard) => navigate(`/dashboard/${dashboard.id}`),
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
      <div {...stylex.props(pageStyles.scroll)}>
        <div {...stylex.props(pageStyles.canvas)}>
          <Flexbox
            horizontal
            align={'flex-end'}
            className={stylex.props(pageStyles.heading).className}
            gap={16}
            justify={'space-between'}
          >
            <Flexbox gap={6} style={{ minWidth: 0 }}>
              <h1 {...stylex.props(pageStyles.title)}>{t('list.title')}</h1>
              <Text className={stylex.props(pageStyles.description).className}>
                {t('list.description')}
              </Text>
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
          <AsyncBoundary
            data={data}
            error={error}
            isEmpty={data?.length === 0}
            isLoading={isLoading}
            loading={<SkeletonList rows={4} />}
            empty={
              <Center flex={1} gap={16} padding={48}>
                <Empty description={t('list.empty')} icon={LayoutDashboardIcon} />
                <Button icon={PlusIcon} onClick={handleCreate}>
                  {t('create.action')}
                </Button>
              </Center>
            }
            onRetry={() => void mutate()}
          >
            <div {...stylex.props(dashboardListStyles.grid)}>
              {dashboards.map((dashboard) => (
                <DashboardListCard
                  dashboard={dashboard}
                  href={`/dashboard/${dashboard.id}`}
                  key={dashboard.id}
                />
              ))}
            </div>
          </AsyncBoundary>
        </div>
      </div>
    </Flexbox>
  );
});

DashboardListPage.displayName = 'DashboardListPage';

export default DashboardListPage;
