'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { ChevronLeftIcon, LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import DashboardBoard from './Board';
import DashboardActionsMenu from './DashboardActionsMenu';

/** Header chrome of the home board page: back to the list, title and board menu. */
const BoardPageHeader = memo<{ dashboardId: string }>(({ dashboardId }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useWorkspaceAwareNavigate();
  const detail = useDashboardStore(dashboardSelectors.dashboardDetail(dashboardId));

  return (
    <NavHeader
      left={
        <Flexbox horizontal align={'center'} gap={6}>
          <ActionIcon
            icon={ChevronLeftIcon}
            size={'small'}
            title={t('list.title')}
            onClick={() => navigate('/dashboard')}
          />
          <Icon icon={LayoutDashboardIcon} size={16} />
          <Text ellipsis weight={500}>
            {detail?.title ?? ''}
          </Text>
        </Flexbox>
      }
      right={
        detail && (
          <DashboardActionsMenu dashboard={detail} onTrashed={() => navigate('/dashboard')} />
        )
      }
    />
  );
});

BoardPageHeader.displayName = 'DashboardBoardPageHeader';

/** Home page of one personal board. */
const DashboardBoardPage = memo<{ dashboardId: string }>(({ dashboardId }) => (
  <Flexbox flex={1} height={'100%'}>
    <BoardPageHeader dashboardId={dashboardId} />
    <WideScreenContainer gap={16} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
      <DashboardBoard dashboardId={dashboardId} />
    </WideScreenContainer>
  </Flexbox>
));

DashboardBoardPage.displayName = 'DashboardBoardPage';

export default DashboardBoardPage;
