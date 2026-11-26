import type { SidebarVisibility } from '@lobechat/types';
import { type DropdownItem } from '@lobehub/ui';
import { confirmModal, Icon, toast } from '@lobehub/ui';
import {
  EyeOffIcon,
  LucideCopy,
  Pen,
  PictureInPicture2Icon,
  Pin,
  PinOff,
  ShieldIcon,
  Trash,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openEditingPopover } from '@/features/EditingPopover/store';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { getDeleteErrorMessageKey } from '@/utils/forbiddenError';

import { useSidebarItemVisibility } from '../../useSidebarItemVisibility';
import { useSidebarPinMenuItems } from '../../useSidebarPinMenuItems';

interface UseGroupDropdownMenuParams {
  anchor: HTMLElement | null;
  avatar?: string;
  backgroundColor?: string;
  id: string;
  memberAvatars?: { avatar?: string; background?: string }[];
  pinned: boolean;
  title: string;
  userId?: string | null;
  visibility?: SidebarVisibility;
}

export const useGroupDropdownMenu = ({
  anchor,
  avatar,
  backgroundColor,
  id,
  memberAvatars,
  pinned,
  title,
  userId,
  visibility,
}: UseGroupDropdownMenuParams): (() => DropdownItem[]) => {
  const { t } = useTranslation(['chat', 'common', 'setting']);

  const { allowed: canEdit } = usePermission('edit_own_content');
  const { canEditResource, canManageResource, isAccessResolved } = useResourceAccess(
    'agentGroup',
    id,
  );
  const canConfigure = canEdit && isAccessResolved && canEditResource;
  const canManage = useResourceManageable(userId);

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);
  const [pinAgentGroup, duplicateAgentGroup, removeAgentGroup] = useHomeStore((s) => [
    s.pinAgentGroup,
    s.duplicateAgentGroup,
    s.removeAgentGroup,
  ]);
  const navigate = useWorkspaceAwareNavigate();

  const activeWorkspaceId = useActiveWorkspaceId();
  // Workspace: personal pin for every member + owner/admin team pin on public
  // groups. Personal mode keeps the single column-backed pin.
  const { menuItems: workspacePinItems } = useSidebarPinMenuItems({
    id,
    pinned,
    type: 'group',
    visibility,
  });

  // Same per-member show/hide as Agent rows: the sidebar filters agents and
  // groups through one membership predicate keyed by row id, so hiding a
  // group only needs the menu entry. Restore it from the Agents page.
  const { isSidebarItemVisible, setSidebarItemVisible } = useSidebarItemVisibility();
  const isShownInSidebar = isSidebarItemVisible({ id, type: 'group', userId });

  return useMemo(
    () => () =>
      [
        ...(activeWorkspaceId
          ? workspacePinItems
          : canConfigure
            ? [
                {
                  icon: <Icon icon={pinned ? PinOff : Pin} />,
                  key: 'pin',
                  label: t(pinned ? 'pinOff' : 'pin'),
                  onClick: () => pinAgentGroup(id, !pinned),
                  sfSymbol: pinned ? 'pin.slash' : 'pin',
                },
              ]
            : []),
        ...(isShownInSidebar
          ? [
              {
                icon: <Icon icon={EyeOffIcon} />,
                key: 'hideFromSidebar',
                label: t('agentViewAll.removeFromSidebar', { ns: 'common' }),
                onClick: async ({ domEvent }: any) => {
                  domEvent?.stopPropagation();
                  try {
                    await setSidebarItemVisible(id, false);
                  } catch (error) {
                    console.error('Failed to hide group from sidebar:', error);
                    toast.error(t('operationFailed', { ns: 'common' }));
                  }
                },
                sfSymbol: 'sidebar.left',
              },
            ]
          : []),
        ...(canConfigure
          ? [
              {
                icon: <Icon icon={Pen} />,
                key: 'rename',
                label: t('rename', { ns: 'common' }),
                onClick: (info: any) => {
                  info.domEvent?.stopPropagation();
                  if (anchor) {
                    openEditingPopover({
                      anchor,
                      avatar,
                      backgroundColor,
                      id,
                      memberAvatars,
                      title,
                      type: 'agentGroup',
                    });
                  }
                },
                sfSymbol: 'pencil',
              },
              {
                icon: <Icon icon={LucideCopy} />,
                key: 'duplicate',
                label: t('duplicate', { ns: 'common' }),
                onClick: ({ domEvent }: any) => {
                  domEvent.stopPropagation();
                  duplicateAgentGroup(id);
                },
                sfSymbol: 'doc.on.doc',
              },
            ]
          : []),
        {
          icon: <Icon icon={PictureInPicture2Icon} />,
          key: 'openInNewWindow',
          label: t('openInNewWindow'),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            openAgentInNewWindow(id);
          },
          sfSymbol: 'macwindow.badge.plus',
        },
        // Member permissions, the handover to a member and the cross-scope
        // Transfer to… / Copy to… live in the group's settings; the row keeps
        // one shortcut to Permissions for the creator and workspace owners,
        // like Agent rows.
        ...(activeWorkspaceId && canConfigure && canManageResource
          ? [
              { type: 'divider' as const },
              {
                icon: <Icon icon={ShieldIcon} />,
                key: 'permission',
                label: t('permission.page.entry', { ns: 'setting' }),
                onClick: ({ domEvent }: any) => {
                  domEvent?.stopPropagation();
                  navigate(`/group/${id}/permission`);
                },
                sfSymbol: 'lock.shield',
              },
            ]
          : []),
        ...(canConfigure && canManage
          ? [
              { type: 'divider' as const },
              {
                danger: true,
                icon: <Icon icon={Trash} />,
                key: 'delete',
                label: t('delete', { ns: 'common' }),
                onClick: ({ domEvent }: any) => {
                  domEvent.stopPropagation();
                  confirmModal({
                    cancelText: t('cancel', { ns: 'common' }),
                    content: t('confirmRemoveChatGroupItemAlert'),
                    okButtonProps: { danger: true },
                    okText: t('delete', { ns: 'common' }),
                    onOk: async () => {
                      try {
                        await removeAgentGroup(id);
                        toast.success(t('confirmRemoveGroupSuccess'));
                      } catch (error) {
                        toast.error(t(getDeleteErrorMessageKey(error), { ns: 'common' }));
                      }
                    },
                    title: t('delete', { ns: 'common' }),
                  });
                },
                sfSymbol: 'trash',
              },
            ]
          : []),
      ] as DropdownItem[],
    [
      activeWorkspaceId,
      workspacePinItems,
      isShownInSidebar,
      setSidebarItemVisible,
      anchor,
      avatar,
      backgroundColor,
      canConfigure,
      canManage,
      memberAvatars,
      t,
      pinned,
      pinAgentGroup,
      id,
      title,
      duplicateAgentGroup,
      openAgentInNewWindow,
      removeAgentGroup,
      canManageResource,
      navigate,
    ],
  );
};
