import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { ArrowDownIcon, ArrowUpIcon, Hash, LucideCheck, SlidersHorizontalIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { openCustomizeSidebarModal } from '@/routes/(main)/home/_layout/Body/CustomizeSidebarModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useCreateMenuItems } from '../../hooks';

interface AgentActionsDropdownMenuProps {
  openConfigGroupModal: () => void;
}

export const useAgentActionsDropdownMenu = ({
  openConfigGroupModal,
}: AgentActionsDropdownMenuProps): MenuProps['items'] => {
  const { t } = useTranslation('common');

  const [agentPageSize, sidebarZones, hiddenSections, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.agentPageSize(s),
    systemStatusSelectors.sidebarZones(s),
    systemStatusSelectors.hiddenSidebarSections(s),
    s.updateSystemStatus,
  ]);

  const myZone = sidebarZones.middle.includes('agent') ? 'middle' : 'bottom';
  const zoneItems = sidebarZones[myZone];
  const visibleItems = zoneItems.filter((k) => !hiddenSections.includes(k));
  const visibleIndex = visibleItems.indexOf('agent');
  const isFirst = visibleIndex === 0;
  const isLast = visibleIndex === visibleItems.length - 1;

  const moveSection = useCallback(
    (direction: 'up' | 'down') => {
      const items = [...zoneItems];
      const idx = items.indexOf('agent');
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= items.length) return;
      [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
      updateSystemStatus({ sidebarZones: { ...sidebarZones, [myZone]: items } });
    },
    [zoneItems, myZone, sidebarZones, updateSystemStatus],
  );

  // Create menu items
  const { createSessionGroupMenuItem, configMenuItem } = useCreateMenuItems();

  return useMemo(() => {
    const createSessionGroupItem = createSessionGroupMenuItem();
    const configItem = configMenuItem(openConfigGroupModal);

    const pageSizeOptions = [5, 10, 15, 20];
    const pageSizeItems = pageSizeOptions.map((size) => ({
      icon: agentPageSize === size ? <Icon icon={LucideCheck} /> : <div />,
      key: `pageSize-${size}`,
      label: t('pageSizeItem', { count: size }),
      onClick: () => {
        updateSystemStatus({ agentPageSize: size });
      },
    }));

    return [
      createSessionGroupItem,
      configItem,
      { type: 'divider' as const },
      {
        children: pageSizeItems,
        extra: agentPageSize,
        icon: <Icon icon={Hash} />,
        key: 'show',
        label: t('navPanel.show'),
      },
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
      { type: 'divider' as const },
      {
        icon: <Icon icon={SlidersHorizontalIcon} />,
        key: 'customizeSidebar',
        label: t('navPanel.customizeSidebar'),
        onClick: () => openCustomizeSidebarModal(),
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [
    agentPageSize,
    updateSystemStatus,
    createSessionGroupMenuItem,
    configMenuItem,
    openConfigGroupModal,
    isFirst,
    isLast,
    moveSection,
    visibleItems.length,
    t,
  ]);
};
