'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FolderClosed, Settings } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { type NavItem, useNavLayout } from '@/hooks/useNavLayout';
import { SidebarTabKey } from '@/store/global/initialState';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gap: 4,
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    paddingBlockStart: '8px',
    paddingBlockEnd: '4px',
    paddingInline: 8,
  },
  item: {
    backgroundColor: { 'default': 'transparent', ':active': cssVar.colorFillTertiary },
    borderRadius: cssVar.borderRadiusLG,
    cursor: 'pointer',
    paddingBlockStart: '10px',
    paddingBlockEnd: '8px',
    paddingInline: 4,
    transitionDuration: '150ms',
    transitionProperty: 'background-color',
    transitionTimingFunction: cssVar.motionEaseOut,
  },
  label: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

// The tab bar already covers these; search opens the desktop command menu,
// which mobile does not host.
const HIDDEN_KEYS = new Set<string>([
  'search',
  SidebarTabKey.Home,
  SidebarTabKey.Community,
  SidebarTabKey.Chat,
]);

/**
 * The desktop sidebar's destinations (tasks, goals, resources, pages, memory,
 * generation, …) as shortcuts above the mobile agent list. Built from
 * `useNavLayout`, so the lab, feature-flag and workspace rules that hide an
 * item on desktop hide it here too.
 */
const FeatureNav = memo(() => {
  const { t } = useTranslation(['common', 'electron']);
  const navigate = useWorkspaceAwareNavigate();
  const { topNavItems, bottomMenuItems } = useNavLayout();
  const enableProjects = useUserStore(labPreferSelectors.enableProjects);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  const items = useMemo(() => {
    const navItems: NavItem[] = [...topNavItems, ...bottomMenuItems].filter(
      (item) => !item.hidden && item.url && !HIDDEN_KEYS.has(item.key),
    );

    if (enableProjects)
      navItems.splice(1, 0, {
        icon: FolderClosed,
        key: 'projects',
        title: t('navigation.projects', { ns: 'electron' }),
        url: '/projects',
      });

    // Personal settings live under the Me tab; a workspace's own settings
    // have no other mobile entry.
    if (activeWorkspaceSlug)
      navItems.push({
        icon: Settings,
        key: SidebarTabKey.Setting,
        title: t('tab.setting'),
        url: '/settings',
      });

    return navItems;
  }, [activeWorkspaceSlug, bottomMenuItems, enableProjects, t, topNavItems]);

  if (items.length === 0) return null;

  return (
    <nav aria-label={t('tab.home')} {...stylex.props(styles.grid)}>
      {items.map((item) => (
        <Flexbox
          align={'center'}
          className={stylex.props(styles.item).className}
          data-testid={`mobile-feature-nav-${item.key}`}
          gap={6}
          key={item.key}
          role={'link'}
          onClick={() => navigate(item.url!)}
        >
          <Icon icon={item.icon} size={22} />
          <Text className={stylex.props(styles.label).className}>{item.title}</Text>
        </Flexbox>
      ))}
    </nav>
  );
});

FeatureNav.displayName = 'MobileHomeFeatureNav';

export default FeatureNav;
