import type { DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { ArrowDownIcon, ArrowUpIcon, EyeOffIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import {
  reorderSidebarItems,
  SIDEBAR_ACCORDION_KEYS,
  SIDEBAR_SPACER_ID,
} from '@/store/global/selectors/systemStatus';

import { openCustomizeSidebarModal } from './CustomizeSidebarModal';

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

  const channelsEnabled = useChannelsEnabled();

  // Sections the member can see: hidden ones and Channels while they are off
  // render nothing, so a move steps over them instead of landing next to them.
  const visibleItems = useMemo(
    () =>
      sidebarItems.filter(
        (k) => !hiddenSections.includes(k) && (channelsEnabled || k !== 'channels'),
      ),
    [sidebarItems, hiddenSections, channelsEnabled],
  );
  const visibleIndex = visibleItems.indexOf(sectionKey);
  const isFirst = visibleIndex <= 0;
  // The spacer stays flush below the section block, so the block's last
  // section has nowhere further down to go.
  const nextVisible = visibleItems[visibleIndex + 1];
  const isLast =
    visibleIndex === -1 ||
    !nextVisible ||
    (nextVisible === SIDEBAR_SPACER_ID && SIDEBAR_ACCORDION_KEYS.has(sectionKey));

  const moveSection = useCallback(
    (direction: 'up' | 'down') => {
      const idx = sidebarItems.indexOf(sectionKey);
      const neighbor = visibleItems[visibleIndex + (direction === 'up' ? -1 : 1)];
      if (idx === -1 || !neighbor) return;
      const next = reorderSidebarItems(sidebarItems, idx, sidebarItems.indexOf(neighbor));
      if (next === sidebarItems) return;
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
