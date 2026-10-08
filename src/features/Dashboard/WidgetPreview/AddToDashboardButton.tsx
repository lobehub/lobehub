'use client';

import { Icon } from '@lobehub/ui';
import { Button, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { CheckIcon, LayoutDashboardIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { openCreateDashboardModal } from '../DashboardFormModal';
import {
  canCreateDashboardFromPreview,
  placeableDashboards,
  placementBoards,
} from './previewWidget';

interface AddToDashboardButtonProps {
  /** Boards the widget is already on; they show checked and are not re-added. */
  placedIds: string[];
  /** The widget's project, when it lives in one: a new board is created there. */
  projectId?: string | null;
  widgetId: string;
}

/** Put a widget on one of its placeable boards — the home level's, and its
 * project's when it lives in one — or on a new one. */
const AddToDashboardButton = memo<AddToDashboardButtonProps>(
  ({ placedIds, projectId, widgetId }) => {
    const { t } = useTranslation('dashboard');
    const useFetchDashboards = useDashboardStore((s) => s.useFetchDashboards);
    const useFetchProjectDashboards = useDashboardStore((s) => s.useFetchProjectDashboards);
    const addWidgetToDashboard = useDashboardStore((s) => s.addWidgetToDashboard);
    const adding = useDashboardStore(dashboardSelectors.isWidgetAdding(widgetId));
    const { isLoading } = useFetchDashboards();
    // A project widget can also be placed on its project's boards.
    const { isLoading: isProjectLoading } = useFetchProjectDashboards(projectId ?? undefined);
    const homeBoards = useDashboardStore(dashboardSelectors.dashboardList());
    const projectBoards = useDashboardStore(
      dashboardSelectors.projectDashboards(projectId ?? undefined),
    );
    const currentUserId = useUserStore(userProfileSelectors.userId);
    const workspaceActive = !!useActiveWorkspaceSlug();
    // Only the caller's own boards can take the placement (addItem writes as
    // the board's creator); teammates' readable boards are not offered.
    const placeable = placeableDashboards(
      placementBoards(homeBoards, projectBoards, projectId, workspaceActive),
      currentUserId,
    );
    // In a workspace, a widget outside a project cannot create a board it
    // could open — home-level boards have no UI there.
    const canCreate = canCreateDashboardFromPreview(projectId, workspaceActive);

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
      ...(placeable.length > 0 && canCreate ? [{ type: 'divider' as const }] : []),
      ...(canCreate
        ? [
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
                  onCreated: (dashboard) =>
                    toast.success(t('chat.added', { title: dashboard.title })),
                  widgetId,
                }),
            },
          ]
        : []),
    ];

    return (
      <DropdownMenu items={items} placement={'bottomLeft'}>
        <Button
          data-widget-add
          icon={LayoutDashboardIcon}
          loading={adding || isLoading || isProjectLoading}
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
