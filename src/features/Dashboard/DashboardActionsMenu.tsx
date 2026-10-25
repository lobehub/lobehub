'use client';

import type { WidgetLevelFilter } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { ActionIcon, confirmModal, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui';
import { MoreHorizontalIcon, Settings2Icon, TrashIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import type { DashboardListItem } from '@/services/dashboard';
import { useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { openDashboardSettingsModal } from './DashboardSettingsModal';

interface DashboardActionsMenuProps {
  dashboard: Pick<
    DashboardListItem,
    'description' | 'id' | 'title' | 'userId' | 'visibility' | 'workspaceId'
  >;
  level?: WidgetLevelFilter;
  /** Called after the board moved to the trash, e.g. to leave its page. */
  onTrashed?: () => void;
}

/**
 * Open a board's settings or trash it. Only its creator with the create_content
 * permission may change it — a demoted owner keeps ownership but the server
 * refuses their writes, so they get no menu either.
 */
const DashboardActionsMenu = memo<DashboardActionsMenuProps>(({ dashboard, level, onTrashed }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const trashDashboard = useDashboardStore((s) => s.trashDashboard);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { allowed } = usePermission('create_content');

  if (!allowed || currentUserId !== dashboard.userId) return null;

  const items: DropdownItem[] = [
    {
      icon: <Icon icon={Settings2Icon} />,
      key: 'settings',
      label: t('actions.settings'),
      onClick: () => openDashboardSettingsModal({ dashboard, level }),
    },
    { type: 'divider' },
    {
      danger: true,
      icon: <Icon icon={TrashIcon} />,
      key: 'trash',
      label: t('actions.trash'),
      onClick: () =>
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('actions.trashConfirm', { title: dashboard.title }),
          okButtonProps: { danger: true },
          okText: t('actions.trash'),
          onOk: async () => {
            try {
              await trashDashboard(dashboard.id, level);
              toast.success(t('actions.trashed', { title: dashboard.title }));
              onTrashed?.();
            } catch (error) {
              console.error('[dashboard] trash failed', error);
              toast.error(t('operationFailed', { ns: 'common' }));
            }
          },
          title: t('actions.trashTitle'),
        }),
    },
  ];

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('actions.more')} />
    </DropdownMenu>
  );
});

DashboardActionsMenu.displayName = 'DashboardActionsMenu';

export default DashboardActionsMenu;
