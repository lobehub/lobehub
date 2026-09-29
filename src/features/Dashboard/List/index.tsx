'use client';

import { Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { LayoutDashboardIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import type { DashboardListItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import DashboardActionsMenu from '../DashboardActionsMenu';
import { openCreateDashboardModal } from '../DashboardFormModal';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    position: relative;

    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    color: inherit;

    background: ${cssVar.colorBgContainer};

    transition: border-color ${cssVar.motionDurationFast};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  `,
  menu: css`
    position: absolute;
    inset-block-start: 12px;
    inset-inline-end: 12px;
  `,
}));

const DashboardListCard = memo<{ dashboard: DashboardListItem }>(({ dashboard }) => {
  const { t } = useTranslation('dashboard');

  return (
    <div className={styles.card} data-dashboard-id={dashboard.id}>
      <WorkspaceLink style={{ color: 'inherit' }} to={`/dashboard/${dashboard.id}`}>
        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} gap={8} style={{ paddingInlineEnd: 24 }}>
            <Icon color={cssVar.colorTextSecondary} icon={LayoutDashboardIcon} size={16} />
            <Text ellipsis weight={500}>
              {dashboard.title}
            </Text>
          </Flexbox>
          <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
            {dashboard.description || t('list.noDescription')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {t('list.updatedAt', { time: dayjs(dashboard.updatedAt).fromNow() })}
          </Text>
        </Flexbox>
      </WorkspaceLink>
      <span className={styles.menu}>
        <DashboardActionsMenu dashboard={dashboard} />
      </span>
    </div>
  );
});

DashboardListCard.displayName = 'DashboardListCard';

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
          <div className={styles.grid}>
            {dashboards.map((dashboard) => (
              <DashboardListCard dashboard={dashboard} key={dashboard.id} />
            ))}
          </div>
        </AsyncBoundary>
      </WideScreenContainer>
    </Flexbox>
  );
});

DashboardListPage.displayName = 'DashboardListPage';

export default DashboardListPage;
