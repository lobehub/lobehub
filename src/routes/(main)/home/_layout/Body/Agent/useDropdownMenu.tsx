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

  const [agentPageSize, sidebarSectionOrder, hiddenSections, updateSystemStatus] = useGlobalStore(
    (s) => [
      systemStatusSelectors.agentPageSize(s),
      systemStatusSelectors.sidebarSectionOrder(s),
      systemStatusSelectors.hiddenSidebarSections(s),
      s.updateSystemStatus,
    ],
  );

  const visibleOrder = sidebarSectionOrder.filter((k) => !hiddenSections.includes(k));
  const visibleIndex = visibleOrder.indexOf('agent');
  const isFirst = visibleIndex === 0;
  const isLast = visibleIndex === visibleOrder.length - 1;

  const moveSection = useCallback(
    (direction: 'up' | 'down') => {
      const newOrder = [...sidebarSectionOrder];
      const idx = newOrder.indexOf('agent');
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= newOrder.length) return;
      [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
      updateSystemStatus({ sidebarSectionOrder: newOrder });
    },
    [sidebarSectionOrder, updateSystemStatus],
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
    visibleOrder.length,
    t,
  ]);
};
