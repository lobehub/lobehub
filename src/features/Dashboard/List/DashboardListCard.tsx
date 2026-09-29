'use client';

import type { DashboardLevelFilter } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import type { DashboardListItem } from '@/services/dashboard';

import DashboardActionsMenu from '../DashboardActionsMenu';

export const dashboardListStyles = createStaticStyles(({ css }) => ({
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

interface DashboardListCardProps {
  dashboard: DashboardListItem;
  /** Where the card opens the board, e.g. `/dashboard/<id>` or a project's board page. */
  href: string;
  /** The list the card sits in, refreshed after a rename or trash. */
  level?: DashboardLevelFilter;
}

/** One board in a board list: name, description, freshness and the board menu. */
const DashboardListCard = memo<DashboardListCardProps>(({ dashboard, href, level }) => {
  const { t } = useTranslation('dashboard');

  return (
    <div className={dashboardListStyles.card} data-dashboard-id={dashboard.id}>
      <WorkspaceLink style={{ color: 'inherit' }} to={href}>
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
      <span className={dashboardListStyles.menu}>
        <DashboardActionsMenu dashboard={dashboard} level={level} />
      </span>
    </div>
  );
});

DashboardListCard.displayName = 'DashboardListCard';

export default DashboardListCard;
