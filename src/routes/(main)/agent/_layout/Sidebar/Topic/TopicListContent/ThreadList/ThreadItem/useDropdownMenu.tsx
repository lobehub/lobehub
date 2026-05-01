import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { PanelTop, PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useChatStore } from '@/store/chat';

interface ThreadItemDropdownMenuProps {
  id: string;
  toggleEditing: (visible?: boolean) => void;
}

export const useThreadItemDropdownMenu = ({
  id,
  toggleEditing,
}: ThreadItemDropdownMenuProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['thread', 'common']);
  const { modal } = App.useApp();

  const [removeThread, pushPortalView] = useChatStore((s) => [s.removeThread, s.pushPortalView]);

  return useCallback(() => {
    return [
      {
        icon: <Icon icon={PencilLine} />,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: () => {
          toggleEditing(true);
        },
      },
      {
        icon: <Icon icon={PanelTop} />,
        key: 'openInPortal',
        label: t('openInPortal'),
        onClick: () => {
          pushPortalView({ threadId: id, type: PortalViewType.Thread });
        },
      },
      {
        type: 'divider' as const,
      },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => {
          modal.confirm({
            centered: true,
            okButtonProps: { danger: true },
            onOk: async () => {
              await removeThread(id);
            },
            title: t('actions.confirmRemoveThread'),
          });
        },
      },
    ].filter(Boolean) as MenuProps['items'];
  }, [id, removeThread, pushPortalView, toggleEditing, t, modal]);
};
