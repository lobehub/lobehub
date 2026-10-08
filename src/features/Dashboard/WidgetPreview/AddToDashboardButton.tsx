'use client';

import { Icon } from '@lobehub/ui';
import { Button, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { CheckIcon, LayoutDashboardIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { openCreateDashboardModal } from '../DashboardFormModal';
import { placeableDashboards } from './previewWidget';

interface AddToDashboardButtonProps {
  /** Boards the widget is already on; they show checked and are not re-added. */
  placedIds: string[];
  /** The widget's project, when it lives in one: a new board is created there. */
  projectId?: string | null;
  widgetId: string;
}

/** Put a widget on one of the home boards, or on a new one. */
const AddToDashboardButton = memo<AddToDashboardButtonProps>(
  ({ placedIds, projectId, widgetId }) => {
    const { t } = useTranslation('dashboard');
    const useFetchDashboards = useDashboardStore((s) => s.useFetchDashboards);
    const addWidgetToDashboard = useDashboardStore((s) => s.addWidgetToDashboard);
    const adding = useDashboardStore(dashboardSelectors.isWidgetAdding(widgetId));
    const { isLoading } = useFetchDashboards();
    const dashboards = useDashboardStore(dashboardSelectors.dashboardList());
    const currentUserId = useUserStore(userProfileSelectors.userId);
    // Only the caller's own boards can take the placement (addItem writes as
    // the board's creator); teammates' readable boards are not offered.
    const placeable = placeableDashboards(dashboards, currentUserId);

    const add = async (dashboard: { id: string; title: string }) => {
      try {
        await addWidgetToDashboard(dashboard.id, widgetId);
        toast.success(t('chat.added', { title: dashboard.title }));
      } catch (error) {
        console.error('[dashboard] add widget failed', error);
        toast.error(t('chat.addFailed'));
      }
    };

    const items: DropdownItem[] = [
      ...placeable.map((dashboard) => {
        const placed = placedIds.includes(dashboard.id);
        return {
          disabled: placed,
          icon: <Icon icon={placed ? CheckIcon : LayoutDashboardIcon} />,
          key: dashboard.id,
          label: dashboard.title,
          onClick: () => void add(dashboard),
        };
      }),
      ...(placeable.length > 0 ? [{ type: 'divider' as const }] : []),
      {
        icon: <Icon icon={PlusIcon} />,
        key: 'new',
        label: t('chat.newDashboard'),
        onClick: () =>
          // Created and placed in one write; a failure keeps the modal open
          // with its error and leaves no empty board behind. The board is
          // created on the widget's own level, so a project widget never
          // creates a home board its link cannot open.
          openCreateDashboardModal({
            level: { projectId: projectId ?? null },
            onCreated: (dashboard) => toast.success(t('chat.added', { title: dashboard.title })),
            widgetId,
          }),
      },
    ];

    return (
      <DropdownMenu items={items} placement={'bottomLeft'}>
        <Button
          data-widget-add
          icon={LayoutDashboardIcon}
          loading={adding || isLoading}
          size={'small'}
        >
          {t('chat.add')}
        </Button>
      </DropdownMenu>
    );
  },
);

AddToDashboardButton.displayName = 'DashboardAddToDashboardButton';

export default AddToDashboardButton;
