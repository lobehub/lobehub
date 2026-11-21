import { type DropdownItem } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { Hash, LucideCheck, SlidersHorizontalIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openCustomizeSidebarModal } from '@/features/HomeSidebar/Body/CustomizeSidebarModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useCreateMenuItems } from '../../hooks';

interface AgentActionsDropdownMenuProps {
  openConfigGroupModal: (scope?: 'private' | 'public') => void;
}

export const useAgentActionsDropdownMenu = ({
  openConfigGroupModal,
}: AgentActionsDropdownMenuProps): DropdownItem[] => {
  const { t } = useTranslation('common');

  const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  // Create menu items
  const { createSessionGroupMenuItem, configMenuItem } = useCreateMenuItems();
  // The workspace Agents section also holds the member's private folders
  // (formerly managed from the separate Private section).
  const isWorkspace = !!useActiveWorkspaceId();

  return useMemo(() => {
    const createSessionGroupItem = createSessionGroupMenuItem();
    const configItem = configMenuItem(() => openConfigGroupModal('public'));
    const privateFolderItems = isWorkspace
      ? [
          {
            ...createSessionGroupMenuItem({ visibility: 'private' }),
            label: t('navPanel.createPrivateFolder'),
          },
          {
            ...configMenuItem(() => openConfigGroupModal('private')),
            key: 'configPrivate',
            label: t('navPanel.managePrivateFolders'),
          },
        ]
      : [];

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
      ...privateFolderItems,
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
    ].filter(Boolean) as DropdownItem[];
  }, [
    agentPageSize,
    updateSystemStatus,
    createSessionGroupMenuItem,
    configMenuItem,
    openConfigGroupModal,
    isWorkspace,
    t,
  ]);
};
