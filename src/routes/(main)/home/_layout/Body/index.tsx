'use client';

import type { MenuProps } from '@lobehub/ui';
import { Accordion, ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { EyeOffIcon, MoreHorizontalIcon, SlidersHorizontalIcon } from 'lucide-react';
import type { Key, ReactElement } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import type { NavItem as NavItemType } from '@/hooks/useNavLayout';
import { useNavLayout } from '@/hooks/useNavLayout';
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

/** Keys rendered in the header — must be excluded from the body to avoid duplicates
 * when migrating users whose persisted sidebarItems still include them. */
const HEADER_KEYS = new Set<string>(['home', 'search']);

const accordionComponents: Record<string, (key: string) => ReactElement> = {
  [GroupKey.Agent]: (key) => <Agent itemKey={key} key={key} />,
  [GroupKey.Recents]: (key) => <Recents itemKey={key} key={key} />,
};

const mergeSidebarExpandedKeys = (
  currentKeys: string[],
  accordionKeys: string[],
  expandedKeys: Key[],
): string[] => {
  const nextExpandedKeys = new Set(expandedKeys.map(String));
  const accordionKeySet = new Set(accordionKeys);
  const nextKeys = currentKeys.filter((key) => !accordionKeySet.has(key));

  for (const key of accordionKeys) {
    if (nextExpandedKeys.has(key)) nextKeys.push(key);
  }

  return nextKeys;
};

const Body = memo(() => {
  const { t } = useTranslation('common');
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { topNavItems, bottomMenuItems } = useNavLayout();
  const sidebarItems = useGlobalStore(systemStatusSelectors.sidebarItems);
  const sidebarExpandedKeys = useGlobalStore(systemStatusSelectors.sidebarExpandedKeys);
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

  // Items that must always be visible regardless of hiddenSections
  const isVisible = useCallback(
    (k: string) => k === GroupKey.Agent || !hiddenSections.includes(k),
    [hiddenSections],
  );

  const visibleKeys = useMemo(
    () => sidebarItems.filter((k) => !HEADER_KEYS.has(k) && isVisible(k)),
    [sidebarItems, isVisible],
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

  const handleAccordionExpandedChange = useCallback(
    (accordionKeys: string[], expandedKeys: Key[]) => {
      updateSystemStatus({
        sidebarExpandedKeys: mergeSidebarExpandedKeys(
          sidebarExpandedKeys,
          accordionKeys,
          expandedKeys,
        ),
      });
    },
    [sidebarExpandedKeys, updateSystemStatus],
  );

  // Render the flat list: group consecutive accordion items into an Accordion,
  // interleave non-accordion keys as nav links.
  const content = useMemo(() => {
    const elements: ReactElement[] = [];
    let accGroup: { element: ReactElement; key: string }[] = [];

    const flushAccordion = () => {
      if (accGroup.length > 0) {
        const accordionKeys = accGroup.map((item) => item.key);

        elements.push(
          <Accordion
            expandedKeys={sidebarExpandedKeys}
            gap={8}
            key={`acc-${elements.length}`}
            onExpandedChange={(keys) => handleAccordionExpandedChange(accordionKeys, keys)}
          >
            {accGroup.map((item) => item.element)}
          </Accordion>,
        );
        accGroup = [];
      }
    };

    for (const key of visibleKeys) {
      if (ACCORDION_KEYS.has(key)) {
        const comp = accordionComponents[key]?.(key);
        if (comp) accGroup.push({ element: comp, key });
      } else {
        flushAccordion();
        const link = renderNavLink(key);
        if (link) elements.push(link);
      }
    }
    flushAccordion();
    return elements;
  }, [visibleKeys, renderNavLink, sidebarExpandedKeys, handleAccordionExpandedChange]);

  return (
    <Flexbox flex={1} gap={1} paddingInline={4}>
      {content}
      <CustomizeSidebarModal />
    </Flexbox>
  );
});

export default Body;
