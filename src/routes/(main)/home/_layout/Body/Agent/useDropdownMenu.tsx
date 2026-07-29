import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { Hash, LucideCheck, SlidersHorizontalIcon } from 'lucide-react';
import { useMemo } from 'react';
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

  const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

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
    t,
  ]);
};
