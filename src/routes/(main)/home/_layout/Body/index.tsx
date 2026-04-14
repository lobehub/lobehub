'use client';

import { Accordion, ActionIcon, DropdownMenu, Flexbox, Icon, type MenuProps } from '@lobehub/ui';
import { EyeOffIcon, MoreHorizontalIcon, SlidersHorizontalIcon } from 'lucide-react';
import { memo, type ReactElement, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { type NavItem as NavItemType, useNavLayout } from '@/hooks/useNavLayout';
import Recents from '@/routes/(main)/home/features/Recents';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isModifierClick } from '@/utils/navigation';
import { prefetchRoute } from '@/utils/router';

import Agent from './Agent';
import { CustomizeSidebarModal, openCustomizeSidebarModal } from './CustomizeSidebarModal';

export enum GroupKey {
  Agent = 'agent',
  Community = 'community',
  Pages = 'pages',
  Project = 'project',
  Recents = 'recents',
  Resource = 'resource',
}

const ACCORDION_KEYS = new Set<string>([GroupKey.Recents, GroupKey.Agent]);

const accordionComponents: Record<string, (key: string) => ReactElement> = {
  [GroupKey.Agent]: (key) => <Agent itemKey={key} key={key} />,
  [GroupKey.Recents]: (key) => <Recents itemKey={key} key={key} />,
};

const Body = memo(() => {
  const { t } = useTranslation('common');
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { topNavItems, bottomMenuItems } = useNavLayout();
  const sidebarZones = useGlobalStore(systemStatusSelectors.sidebarZones);
  const hiddenSections = useGlobalStore(systemStatusSelectors.hiddenSidebarSections);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const hideSection = useCallback(
    (key: string) => {
      updateSystemStatus({ hiddenSidebarSections: [...hiddenSections, key] });
    },
    [hiddenSections, updateSystemStatus],
  );

  const getContextMenuItems = useCallback(
    (key: string): MenuProps['items'] => [
      {
        icon: <Icon icon={EyeOffIcon} />,
        key: 'hideSection',
        label: t('navPanel.hideSection'),
        onClick: () => hideSection(key),
      },
      { type: 'divider' as const },
      {
        icon: <Icon icon={SlidersHorizontalIcon} />,
        key: 'customizeSidebar',
        label: t('navPanel.customizeSidebar'),
        onClick: () => openCustomizeSidebarModal(),
      },
    ],
    [t, hideSection],
  );

  // Build a map of nav link items by key
  const navLinkItems = useMemo(() => {
    const map = new Map<string, NavItemType>();
    for (const item of topNavItems) map.set(item.key, item);
    for (const item of bottomMenuItems) map.set(item.key, item);
    return map;
  }, [topNavItems, bottomMenuItems]);

  // Filter hidden items per zone
  const topKeys = useMemo(
    () => sidebarZones.top.filter((k) => !hiddenSections.includes(k)),
    [sidebarZones.top, hiddenSections],
  );
  const middleKeys = useMemo(
    () => sidebarZones.middle.filter((k) => k === GroupKey.Agent || !hiddenSections.includes(k)),
    [sidebarZones.middle, hiddenSections],
  );
  const bottomKeys = useMemo(
    () => sidebarZones.bottom.filter((k) => !hiddenSections.includes(k)),
    [sidebarZones.bottom, hiddenSections],
  );

  const renderNavLink = useCallback(
    (key: string) => {
      const navItem = navLinkItems.get(key);
      if (!navItem || navItem.hidden) return null;
      return (
        <Link
          key={key}
          to={navItem.url!}
          onMouseEnter={() => prefetchRoute(navItem.url!)}
          onClick={(e) => {
            if (isModifierClick(e)) return;
            e.preventDefault();
            navigate(navItem.url!);
          }}
        >
          <NavItem
            active={tab === key}
            contextMenuItems={getContextMenuItems(key)}
            icon={navItem.icon}
            title={navItem.title}
            actions={
              <DropdownMenu items={getContextMenuItems(key)} nativeButton={false}>
                <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
              </DropdownMenu>
            }
          />
        </Link>
      );
    },
    [navLinkItems, tab, getContextMenuItems, navigate],
  );

  // Middle zone: group consecutive accordion items, interleave nav links
  const middleContent = useMemo(() => {
    const elements: ReactElement[] = [];
    let accGroup: ReactElement[] = [];

    const flushAccordion = () => {
      if (accGroup.length > 0) {
        elements.push(
          <Accordion
            defaultExpandedKeys={[GroupKey.Recents, GroupKey.Project, GroupKey.Agent]}
            gap={8}
            key={`acc-${elements.length}`}
          >
            {accGroup}
          </Accordion>,
        );
        accGroup = [];
      }
    };

    for (const key of middleKeys) {
      if (ACCORDION_KEYS.has(key)) {
        const comp = accordionComponents[key]?.(key);
        if (comp) accGroup.push(comp);
      } else {
        flushAccordion();
        const link = renderNavLink(key);
        if (link) elements.push(link);
      }
    }
    flushAccordion();
    return elements;
  }, [middleKeys, renderNavLink]);

  const topNavLinks = topKeys.map(renderNavLink).filter(Boolean);
  const bottomNavLinks = bottomKeys.map(renderNavLink).filter(Boolean);

  return (
    <Flexbox flex={1} justify={'space-between'} paddingInline={4}>
      <Flexbox gap={4}>
        {topNavLinks.length > 0 && <Flexbox gap={1}>{topNavLinks}</Flexbox>}
        {middleContent}
      </Flexbox>
      {bottomNavLinks.length > 0 && (
        <Flexbox gap={1} paddingBlock={4} style={{ marginTop: 12, overflow: 'hidden' }}>
          {bottomNavLinks}
        </Flexbox>
      )}
      <CustomizeSidebarModal />
    </Flexbox>
  );
});

export default Body;
