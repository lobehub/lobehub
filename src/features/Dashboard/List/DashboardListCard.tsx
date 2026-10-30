'use client';

import type { WidgetLevelFilter } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import type { DashboardListItem } from '@/services/dashboard';

import DashboardActionsMenu from '../DashboardActionsMenu';
import DashboardAvatar from '../DashboardAvatar';

export const dashboardListStyles = stylex.create({
  // The card is a `stylex.defaultMarker()` element: `menu` shows while it is hovered.
  card: {
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow: { 'default': null, ':hover': cssVar.boxShadowTertiary },
    color: 'inherit',
    display: 'block',
    height: '100%',
    padding: '16px',
    position: 'relative',
    transition: `border-color ${cssVar.motionDurationMid}, box-shadow ${cssVar.motionDurationMid}`,
  },
  description: {
    // Two lines reserved, so cards with and without a description line up.
    fontSize: '13px',
    lineHeight: 1.6,
    minHeight: 'calc(2 * 1.6em)',
  },
  grid: {
    display: 'grid',
    gap: '16px',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  },
  icon: {
    backgroundColor: `color-mix(in srgb, ${cssVar.geekblue} 12%, transparent)`,
    backgroundImage: 'none',
    borderRadius: cssVar.borderRadius,
    color: cssVar.geekblue,
    flex: 'none',
    height: '36px',
    width: '36px',
  },
  menu: {
    insetBlockStart: '12px',
    insetInlineEnd: '12px',
    opacity: {
      'default': 0,
      ':focus-within': 1,
      ":has([aria-expanded='true'])": 1,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover')]: 1,
    },
    position: 'absolute',
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  meta: {
    color: cssVar.colorTextTertiary,
    fontSize: '12px',
  },
});

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
    <div
      {...stylex.props(dashboardListStyles.card, stylex.defaultMarker())}
      data-dashboard-id={dashboard.id}
    >
      <WorkspaceLink style={{ color: 'inherit', display: 'block' }} to={href}>
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} gap={12} style={{ paddingInlineEnd: 24 }}>
            <DashboardAvatar icon={dashboard.icon} size={36} title={dashboard.title} />
            <Text ellipsis fontSize={15} weight={600}>
              {dashboard.title}
            </Text>
          </Flexbox>
          <Text
            className={stylex.props(dashboardListStyles.description).className}
            ellipsis={{ rows: 2 }}
            style={{
              color: dashboard.description ? cssVar.colorTextSecondary : cssVar.colorTextQuaternary,
            }}
          >
            {dashboard.description || t('list.noDescription')}
          </Text>
          <span {...stylex.props(dashboardListStyles.meta)}>
            {t('list.updatedAt', { time: dayjs(dashboard.updatedAt).fromNow() })}
          </span>
        </Flexbox>
      </WorkspaceLink>
      <span data-dashboard-menu {...stylex.props(dashboardListStyles.menu)}>
        <DashboardActionsMenu dashboard={dashboard} level={level} />
      </span>
    </div>
  );
});

DashboardListCard.displayName = 'DashboardListCard';

export default DashboardListCard;
