import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { Hash, LucideCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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

  const [agentPageSize, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.agentPageSize(s),
    s.updateSystemStatus,
  ]);

  // Create menu items
  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createSessionGroupMenuItem,
    configMenuItem,
  } = useCreateMenuItems();

  return useMemo(() => {
    const createAgentItem = createAgentMenuItem();
    const createGroupChatItem = createGroupChatMenuItem();
    const createSessionGroupItem = createSessionGroupMenuItem();
    const configItem = configMenuItem(openConfigGroupModal);

    const pageSizeOptions = [10, 15, 20, 40];
    const pageSizeItems = pageSizeOptions.map((size) => ({
      icon: agentPageSize === size ? <Icon icon={LucideCheck} /> : <div />,
      key: `pageSize-${size}`,
      label: t('pageSizeItem', { count: size }),
      onClick: () => {
        updateSystemStatus({ agentPageSize: size });
      },
    }));

    return [
      createAgentItem,
      createGroupChatItem,
      { type: 'divider' as const },
      {
        children: pageSizeItems,
        icon: <Icon icon={Hash} />,
        key: 'displayItems',
        label: t('navPanel.displayItems'),
      },
      { type: 'divider' as const },
      createSessionGroupItem,
      configItem,
    ].filter(Boolean) as MenuProps['items'];
  }, [
    agentPageSize,
    updateSystemStatus,
    createAgentMenuItem,
    createGroupChatMenuItem,
    createSessionGroupMenuItem,
    configMenuItem,
    openConfigGroupModal,
    t,
  ]);
};
