'use client';

import type { WidgetLevelFilter } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import {
  ActionIcon,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  toast,
} from '@lobehub/ui/base-ui';
import { MoreHorizontalIcon, PencilIcon, TrashIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { openRenameDashboardModal } from './DashboardFormModal';

interface DashboardActionsMenuProps {
  dashboard: { id: string; title: string; userId: string };
  level?: WidgetLevelFilter;
  /** Called after the board moved to the trash, e.g. to leave its page. */
  onTrashed?: () => void;
}

/** Rename / trash a board. Only its creator may change it, so others get no menu. */
const DashboardActionsMenu = memo<DashboardActionsMenuProps>(({ dashboard, level, onTrashed }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const trashDashboard = useDashboardStore((s) => s.trashDashboard);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  if (currentUserId !== dashboard.userId) return null;

  const items: DropdownItem[] = [
    {
      icon: <Icon icon={PencilIcon} />,
      key: 'rename',
      label: t('actions.rename'),
      onClick: () =>
        openRenameDashboardModal({ dashboardId: dashboard.id, level, title: dashboard.title }),
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
