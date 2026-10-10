'use client';

import type { WidgetLevelFilter } from '@lobechat/types';
import { Center, createStaticStyles, cssVar,Flexbox, Icon, Text   } from '@lobehub/ui';
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

    display: block;

    height: 100%;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    color: inherit;

    background: ${cssVar.colorBgContainer};

    transition:
      border-color ${cssVar.motionDurationMid},
      box-shadow ${cssVar.motionDurationMid};

    &:hover {
      border-color: ${cssVar.colorBorder};
      box-shadow: ${cssVar.boxShadowTertiary};
    }

    &:hover [data-dashboard-menu] {
      opacity: 1;
    }
  `,
  description: css`
    /* Two lines reserved, so cards with and without a description line up. */
    min-height: calc(2 * 1.6em);
    font-size: 13px;
    line-height: 1.6;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  `,
  icon: css`
    flex: none;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.geekblue};

    background: color-mix(in srgb, ${cssVar.geekblue} 12%, transparent);
  `,
  menu: css`
    position: absolute;
    inset-block-start: 12px;
    inset-inline-end: 12px;

    opacity: 0;

    transition: opacity ${cssVar.motionDurationMid};

    &:focus-within,
    &:has([aria-expanded='true']) {
      opacity: 1;
    }

    @media (hover: none) {
      opacity: 1;
    }
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface DashboardListCardProps {
  dashboard: DashboardListItem;
  /** Where the card opens the board, e.g. `/dashboard/<id>` or a project's board page. */
  href: string;
  /** The list the card sits in, refreshed after a rename or trash. */
  level?: WidgetLevelFilter;
}

/** One board in a board list: name, description, freshness and the board menu. */
const DashboardListCard = memo<DashboardListCardProps>(({ dashboard, href, level }) => {
  const { t } = useTranslation('dashboard');

  return (
    <div className={dashboardListStyles.card} data-dashboard-id={dashboard.id}>
      <WorkspaceLink style={{ color: 'inherit', display: 'block' }} to={href}>
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} gap={12} style={{ paddingInlineEnd: 24 }}>
            <Center className={dashboardListStyles.icon}>
              <Icon icon={LayoutDashboardIcon} size={18} />
            </Center>
            <Text ellipsis fontSize={15} weight={600}>
              {dashboard.title}
            </Text>
          </Flexbox>
          <Text
            className={dashboardListStyles.description}
            ellipsis={{ rows: 2 }}
            style={{
              color: dashboard.description ? cssVar.colorTextSecondary : cssVar.colorTextQuaternary,
            }}
          >
            {dashboard.description || t('list.noDescription')}
          </Text>
          <span className={dashboardListStyles.meta}>
            {t('list.updatedAt', { time: dayjs(dashboard.updatedAt).fromNow() })}
          </span>
        </Flexbox>
      </WorkspaceLink>
      <span data-dashboard-menu className={dashboardListStyles.menu}>
        <DashboardActionsMenu dashboard={dashboard} level={level} />
      </span>
    </div>
  );
});

DashboardListCard.displayName = 'DashboardListCard';

export default DashboardListCard;
