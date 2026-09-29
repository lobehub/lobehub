'use client';

import { Center, Empty, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { LayoutDashboardIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { openCreateDashboardModal } from '../DashboardFormModal';
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
      <WideScreenContainer gap={16} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Text type={'secondary'}>{t('list.description')}</Text>
          <Button data-dashboard-create icon={PlusIcon} type={'primary'} onClick={handleCreate}>
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
          <div className={dashboardListStyles.grid}>
            {dashboards.map((dashboard) => (
              <DashboardListCard
                dashboard={dashboard}
                href={`/dashboard/${dashboard.id}`}
                key={dashboard.id}
              />
            ))}
          </div>
        </AsyncBoundary>
      </WideScreenContainer>
    </Flexbox>
  );
});

DashboardListPage.displayName = 'DashboardListPage';

export default DashboardListPage;
