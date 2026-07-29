import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { ArrowDownIcon, ArrowUpIcon, Hash, LucideCheck, SlidersHorizontalIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openCustomizeSidebarModal } from '@/routes/(main)/home/_layout/Body/CustomizeSidebarModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { reorderSidebarItems } from '@/store/global/selectors/systemStatus';

import { useCreateMenuItems } from '../../hooks';

interface PrivateActionsDropdownMenuProps {
  openConfigGroupModal: () => void;
}

export const usePrivateActionsDropdownMenu = ({
  openConfigGroupModal,
}: PrivateActionsDropdownMenuProps): MenuProps['items'] => {
  const { t } = useTranslation('common');

  const activeWorkspaceId = useActiveWorkspaceId();
  const privateAgentPageSize = useGlobalStore(systemStatusSelectors.privateAgentPageSize);
  const sidebarItems = useGlobalStore(systemStatusSelectors.sidebarItems(activeWorkspaceId));
  const hiddenSections = useGlobalStore(
    systemStatusSelectors.hiddenSidebarSections(activeWorkspaceId),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const visibleItems = sidebarItems.filter((k) => !hiddenSections.includes(k));
  const visibleIndex = visibleItems.indexOf('private');
  const isFirst = visibleIndex <= 0;
  const isLast = visibleIndex === visibleItems.length - 1;

  const moveSection = useCallback(
    (direction: 'up' | 'down') => {
      const idx = sidebarItems.indexOf('private');
      if (idx === -1) return;
      const next = reorderSidebarItems(sidebarItems, idx, direction === 'up' ? idx - 1 : idx + 1);
      if (next === sidebarItems) return;
      updateSystemStatus({ sidebarItems: next });
    },
    [sidebarItems, updateSystemStatus],
  );

  const { createSessionGroupMenuItem, configMenuItem } = useCreateMenuItems();

  return useMemo(() => {
    const createSessionGroupItem = createSessionGroupMenuItem({ visibility: 'private' });
    const configItem = configMenuItem(openConfigGroupModal);

    const pageSizeOptions = [5, 10, 15, 20];
    const pageSizeItems = pageSizeOptions.map((size) => ({
      icon: privateAgentPageSize === size ? <Icon icon={LucideCheck} /> : <div />,
      key: `pageSize-${size}`,
      label: t('pageSizeItem', { count: size }),
      onClick: () => {
        updateSystemStatus({ privateAgentPageSize: size });
      },
    }));

    return [
      createSessionGroupItem,
      configItem,
      { type: 'divider' as const },
      {
        children: pageSizeItems,
        extra: privateAgentPageSize,
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
    privateAgentPageSize,
    updateSystemStatus,
    createSessionGroupMenuItem,
    configMenuItem,
    openConfigGroupModal,
    isFirst,
    isLast,
    moveSection,
    t,
  ]);
};
