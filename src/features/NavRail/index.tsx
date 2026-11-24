'use client';

import { NAV_RAIL_ITEMS } from '@lobechat/business-const';
import type { BrandIconKey } from '@lobechat/business-const/icons';
import { createStaticStyles, cx, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { memo, Suspense, useMemo } from 'react';

import { brandIcon } from '@/components/BrandIcon';
import Footer from '@/features/HomeSidebar/Footer';
import User from '@/features/HomeSidebar/Header/components/User';
import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useNavLayout } from '@/hooks/useNavLayout';
import { SidebarTabKey } from '@/store/global/initialState';
import { isModifierClick } from '@/utils/navigation';

import { NAV_RAIL_WIDTH } from './constants';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBgHover};

    &:hover {
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
  // The shared footer lays its entries out in a row for the panel; the rail
  // stacks them.
  footer: css`
    > div {
      flex-direction: column;
      padding: 0;
    }
  `,
  item: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextTertiary};

    transition:
      color 0.15s ${cssVar.motionEaseOut},
      background 0.15s ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  rail: css`
    user-select: none;

    flex: none;

    width: ${NAV_RAIL_WIDTH}px;
    padding-block: 8px;
    padding-inline: 4px 12px;
  `,
}));

const HOME_PANEL_ROUTE_TABS = new Set<string>(['agent', 'group', 'project']);

// The brand's icon for each rail entry, and the filled one it shows while active.
const RAIL_BRAND_ICONS: Partial<Record<string, [BrandIconKey, BrandIconKey?]>> = {
  [SidebarTabKey.Community]: ['nav.community', 'nav.communityActive'],
  [SidebarTabKey.Home]: ['nav.home', 'nav.homeActive'],
  [SidebarTabKey.Image]: ['nav.image', 'nav.imageActive'],
  [SidebarTabKey.Memory]: ['nav.memory'],
  [SidebarTabKey.Pages]: ['nav.pages'],
  [SidebarTabKey.Resource]: ['nav.resource', 'nav.resourceActive'],
  [SidebarTabKey.Tasks]: ['nav.tasks', 'nav.tasksActive'],
};

const railIcon = (key: string, fallback: any, active: boolean) => {
  const [icon, activeIcon] = RAIL_BRAND_ICONS[key] ?? [];
  if (!icon) return fallback;
  const base = brandIcon(icon, fallback);
  return active && activeIcon ? brandIcon(activeIcon, base) : base;
};

/**
 * Outer level of the two-level navigation (`NAV_RAIL_ENABLED`): page links on
 * top, help and account at the bottom. The entries come from `useNavLayout`, so
 * the rail and the single-panel layout can never disagree about what exists.
 */
const NavRail = memo(() => {
  const routeTab = useActiveTabKey();
  // An agent, group or project page shown beside the Home panel belongs to Home.
  const navKey = useActiveNavKey();
  const tab =
    navKey === 'home' && HOME_PANEL_ROUTE_TABS.has(routeTab) ? SidebarTabKey.Home : routeTab;
  const navigate = useWorkspaceAwareNavigate();
  const { bottomMenuItems, topNavItems } = useNavLayout();

  const items = useMemo(() => {
    const available = [...topNavItems, ...bottomMenuItems].filter(
      (item) => item.url && !item.hidden,
    );
    if (!NAV_RAIL_ITEMS) return available;

    return NAV_RAIL_ITEMS.flatMap((key) => available.find((item) => item.key === key) ?? []);
  }, [bottomMenuItems, topNavItems]);

  return (
    <Flexbox
      align={'center'}
      as={'nav'}
      className={styles.rail}
      data-brand-slot="nav-rail"
      gap={20}
    >
      <Flexbox flex={1} gap={12}>
        {items.map((item) => {
          const active = tab === item.key;

          return (
            <Tooltip key={item.key} placement={'right'} title={item.title}>
              <WorkspaceLink
                aria-current={active ? 'page' : undefined}
                aria-label={item.title}
                className={cx(styles.item, active && styles.active)}
                to={item.url!}
                onClick={(e) => {
                  if (isModifierClick(e)) return;
                  e.preventDefault();
                  item.onClick?.();
                  navigate(item.url!);
                }}
              >
                <Icon icon={railIcon(item.key, item.icon, active)} size={20} />
              </WorkspaceLink>
            </Tooltip>
          );
        })}
      </Flexbox>
      <Flexbox align={'center'} gap={12}>
        <Suspense>
          <div className={styles.footer}>
            <Footer />
          </div>
        </Suspense>
        <User lite />
      </Flexbox>
    </Flexbox>
  );
});

NavRail.displayName = 'NavRail';

export default NavRail;
