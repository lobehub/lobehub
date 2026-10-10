'use client';

import type { WidgetLevelFilter } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Text  } from '@lobehub/ui';
import { ChevronLeftIcon, LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import DashboardBoard from './Board';
import DashboardActionsMenu from './DashboardActionsMenu';
import { dashboardPageStyles as styles } from './pageStyles';

interface DashboardBoardPageProps {
  /** The board list this page returns to, e.g. `/dashboard` or a project's dashboards. */
  backPath?: string;
  dashboardId: string;
  /** The list level to refresh after a rename or trash. */
  level?: WidgetLevelFilter;
}

/** Header chrome of a board page: back to the list, title and board menu. */
const BoardPageHeader = memo<DashboardBoardPageProps>(
  ({ backPath = '/dashboard', dashboardId, level }) => {
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
              onClick={() => navigate(backPath)}
            />
            <Icon icon={LayoutDashboardIcon} size={16} />
            <Text ellipsis weight={500}>
              {detail?.title ?? ''}
            </Text>
          </Flexbox>
        }
        right={
          detail && (
            <DashboardActionsMenu
              dashboard={detail}
              level={level}
              onTrashed={() => navigate(backPath)}
            />
          )
        }
      />
    );
  },
);

BoardPageHeader.displayName = 'DashboardBoardPageHeader';

/** Page of one board — on the home level or inside a project. */
const DashboardBoardPage = memo<DashboardBoardPageProps>(({ backPath, dashboardId, level }) => (
  <Flexbox flex={1} height={'100%'}>
    <BoardPageHeader backPath={backPath} dashboardId={dashboardId} level={level} />
    <div className={styles.scroll}>
      <div className={styles.canvas}>
        <DashboardBoard dashboardId={dashboardId} />
      </div>
    </div>
  </Flexbox>
));

DashboardBoardPage.displayName = 'DashboardBoardPage';

export default DashboardBoardPage;
