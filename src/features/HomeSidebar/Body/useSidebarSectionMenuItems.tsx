import type { DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { ArrowDownIcon, ArrowUpIcon, EyeOffIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { useFetchFavorites } from '@/features/Favorites';
import { useNavLayout } from '@/hooks/useNavLayout';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { reorderSidebarItems, SIDEBAR_SPACER_ID } from '@/store/global/selectors/systemStatus';
import { useHomeStore } from '@/store/home';
import { favoriteSelectors, homeRecentSelectors } from '@/store/home/selectors';
import { createRecentQueryKey } from '@/store/home/slices/recent/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { openCustomizeSidebarModal } from './CustomizeSidebarModal';

/** Whether a sidebar entry renders anything right now, mirroring the section components. */
const useSectionRenders = (): ((key: string) => boolean) => {
  const channelsEnabled = useChannelsEnabled();
  const isLogin = useUserStore(authSelectors.isLogin);
  const favoriteCount = useHomeStore((s) => favoriteSelectors.favoriteList(s)?.length);
  // SWR dedupes this with the Favorites section's own request.
  const { error: favoritesError } = useFetchFavorites();
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);
  const recentCount = useHomeStore(
    (s) => homeRecentSelectors.query(createRecentQueryKey(recentPageSize + 1))(s)?.length,
  );
  const { bottomMenuItems, topNavItems } = useNavLayout();

  return useMemo(() => {
    const links = new Set(
      [...topNavItems, ...bottomMenuItems].filter((item) => !item.hidden).map((item) => item.key),
    );

    return (key: string) => {
      switch (key) {
        case 'agent': {
          return true;
        }
        case 'channels': {
          return channelsEnabled;
        }
        // Mirrors the section: shown with items, or with a retry after a failed first load.
        case 'favorites': {
          return favoriteCount === undefined ? !!favoritesError : favoriteCount > 0;
        }
        // Recents show a skeleton while loading and disappear once known to be empty.
        case 'recents': {
          return !!isLogin && recentCount !== 0;
        }
        // The header renders Home and Search; legacy layouts may still list them.
        case 'home':
        case 'search': {
          return false;
        }
        default: {
          return links.has(key);
        }
      }
    };
  }, [
    bottomMenuItems,
    channelsEnabled,
    favoriteCount,
    favoritesError,
    isLogin,
    recentCount,
    topNavItems,
  ]);
};

/**
 * The layout entries every home-sidebar section header offers in its "…" and
 * right-click menus: move up / down, hide, and the customize-sidebar modal.
 * A section adds its own entries ahead of these.
 */
export const useSidebarSectionMenuItems = (sectionKey: string): DropdownItem[] => {
  const { t } = useTranslation('common');
  const activeWorkspaceId = useActiveWorkspaceId();
  const sidebarItems = useGlobalStore(systemStatusSelectors.sidebarItems(activeWorkspaceId));
  const hiddenSections = useGlobalStore(
    systemStatusSelectors.hiddenSidebarSections(activeWorkspaceId),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const renders = useSectionRenders();

  // Sections the member can see. Hidden ones, Channels while they are off,
  // empty Favorites / Recents and unavailable links render nothing, so a move
  // steps over them instead of swapping with something invisible.
  const visibleItems = useMemo(
    () =>
      sidebarItems.filter(
        // Agents ignore the hidden list, as the sidebar body does.
        // The section whose menu this is is on screen, whatever the stores say.
        (k) => k === sectionKey || ((k === 'agent' || !hiddenSections.includes(k)) && renders(k)),
      ),
    [sectionKey, sidebarItems, hiddenSections, renders],
  );
  const visibleIndex = visibleItems.indexOf(sectionKey);
  const isFirst = visibleIndex <= 0;
  const isLast = visibleIndex === -1 || !visibleItems[visibleIndex + 1];

  const moveSection = useCallback(
    (direction: 'up' | 'down') => {
      const neighbor = visibleItems[visibleIndex + (direction === 'up' ? -1 : 1)];
      if (visibleIndex === -1 || !neighbor) return;
      // Step one slot at a time so the block rules of `reorderSidebarItems`
      // (sections stay together) apply on the way. The saved spacer renders
      // nothing and re-anchors below the block, so a step jumps over it.
      const step = direction === 'up' ? -1 : 1;
      const passed = (items: string[]) =>
        direction === 'up'
          ? items.indexOf(sectionKey) < items.indexOf(neighbor)
          : items.indexOf(sectionKey) > items.indexOf(neighbor);
      let next = sidebarItems;
      for (let guard = 0; guard < sidebarItems.length && !passed(next); guard++) {
        const idx = next.indexOf(sectionKey);
        const slot = next[idx + step] === SIDEBAR_SPACER_ID ? idx + step * 2 : idx + step;
        const moved = reorderSidebarItems(next, idx, slot);
        if (moved === next) break;
        next = moved;
      }
      if (next === sidebarItems || !passed(next)) return;
      updateSystemStatus({ sidebarItems: next });
    },
    [sectionKey, sidebarItems, visibleItems, visibleIndex, updateSystemStatus],
  );

  const hideSection = useCallback(() => {
    updateSystemStatus({ hiddenSidebarSections: [...hiddenSections, sectionKey] });
  }, [hiddenSections, sectionKey, updateSystemStatus]);

  return useMemo(
    () =>
      [
        {
          disabled: isFirst,
          icon: <Icon icon={ArrowUpIcon} />,
          key: 'moveUp',
          label: t('navPanel.moveUp'),
          onClick: () => moveSection('up'),
        },
        {
          disabled: isLast,
          icon: <Icon icon={ArrowDownIcon} />,
          key: 'moveDown',
          label: t('navPanel.moveDown'),
          onClick: () => moveSection('down'),
        },
        {
          icon: <Icon icon={EyeOffIcon} />,
          key: 'hideSection',
          label: t('navPanel.hideSection'),
          onClick: hideSection,
        },
        { type: 'divider' as const },
        {
          icon: <Icon icon={SlidersHorizontalIcon} />,
          key: 'customizeSidebar',
          label: t('navPanel.customizeSidebar'),
          onClick: () => openCustomizeSidebarModal(),
        },
      ] as DropdownItem[],
    [t, isFirst, isLast, moveSection, hideSection],
  );
};
