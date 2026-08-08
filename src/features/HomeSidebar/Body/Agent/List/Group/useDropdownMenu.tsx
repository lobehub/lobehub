import type { SFSymbol } from '@lobechat/electron-client-ipc';
import { type SidebarVisibility } from '@lobechat/types';
import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { EyeOffIcon, GlobeIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';
import { useHomeStore } from '@/store/home';

import { useCreateMenuItems, useSessionGroupMenuItems } from '../../../../hooks';
import { useSidebarGroupVisibility } from '../../useSidebarGroupVisibility';

interface GroupDropdownMenuProps {
  anchor: HTMLElement | null;
  id?: string;
  isCustomGroup?: boolean;
  isPinned?: boolean;
  name?: string;
  openConfigGroupModal: () => void;
  visibility?: SidebarVisibility;
}

export const useGroupDropdownMenu = ({
  anchor,
  id,
  isCustomGroup,
  isPinned,
  name,
  openConfigGroupModal,
  visibility,
}: GroupDropdownMenuProps): MenuProps['items'] => {
  const { t } = useTranslation(['common', 'chat']);

  const { allowed: canEdit } = usePermission('edit_own_content');
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);

  // Session group menu items
  const { renameGroupMenuItem, configGroupMenuItem, deleteGroupMenuItem } =
    useSessionGroupMenuItems();

  // Create menu items
  const { createAgentMenuItem, createConnectAgentMenuItem, createGroupChatMenuItem } =
    useCreateMenuItems();

  // "Publish to Workspace" is one-way and only meaningful in workspace mode
  // for the creator's own still-private folder. Once a folder is `public`,
  // members may have anchored their own work to it, so it can't be
  // re-privatized. The server enforces both rules; the UI just hides the
  // entry when it would never succeed.
  const activeWorkspaceId = useActiveWorkspaceId();
  const isPrivate = visibility === 'private';
  const showPublishAction = Boolean(activeWorkspaceId && id && isCustomGroup) && isPrivate;

  // Hiding is the caller's own view of a shared folder, so it needs no edit
  // permission. Getting it back goes through Category Management, which stays
  // reachable from the default list's header menu.
  const { setSidebarGroupVisible } = useSidebarGroupVisibility();

  return useMemo(() => {
    const createAgentItem = createAgentMenuItem({ groupId: id, isPinned, visibility });
    const createGroupChatItem = createGroupChatMenuItem({ groupId: id, visibility });
    const connectAgentItem = createConnectAgentMenuItem({ groupId: id, visibility });
    const configItem = configGroupMenuItem(openConfigGroupModal);
    const renameItem = id && name ? renameGroupMenuItem(id, name, anchor) : null;
    const deleteItem = id ? deleteGroupMenuItem(id) : null;
    const hideItem = id
      ? {
          icon: <Icon icon={EyeOffIcon} />,
          key: 'hideFromSidebar',
          label: t('sessionGroup.hideFromSidebar', { ns: 'chat' }),
          onClick: async (info: any) => {
            info.domEvent?.stopPropagation();
            try {
              await setSidebarGroupVisible(id, false);
            } catch (error) {
              // Workspace mode rolls back, personal mode can keep an unsaved
              // optimistic value — either way the folder looks hidden when it
              // is not, so say so.
              console.error('Failed to hide folder from sidebar:', error);
              toast.error(t('operationFailed', { ns: 'common' }));
            }
          },
          sfSymbol: 'eye.slash' as SFSymbol,
        }
      : null;
    const publishItem = showPublishAction
      ? {
          disabled: !canEdit,
          icon: <Icon icon={GlobeIcon} />,
          key: 'publishToWorkspace',
          sfSymbol: 'globe' as SFSymbol,
          label: t('sessionGroup.publishToWorkspace', {
            defaultValue: 'Publish to Workspace',
            ns: 'chat',
          }),
          onClick: async (info: any) => {
            info.domEvent?.stopPropagation();
            if (!canEdit || !id) return;
            confirmModal({
              cancelText: t('cancel'),
              content: t('sessionGroup.publishToWorkspaceConfirm', {
                defaultValue:
                  'Other workspace members will be able to use this folder. ' +
                  'You will not be able to make it private again.',
                ns: 'chat',
              }),
              okText: t('sessionGroup.publishToWorkspace', {
                defaultValue: 'Publish to Workspace',
                ns: 'chat',
              }),
              onOk: async () => {
                try {
                  await lambdaClient.sessionGroup.publishSessionGroupToWorkspace.mutate({ id });
                  await refreshAgentList();
                  toast.success(
                    t('sessionGroup.publishToWorkspaceSuccess', {
                      defaultValue: 'Published to workspace',
                      ns: 'chat',
                    }),
                  );
                } catch (error) {
                  console.error('Failed to publish group:', error);
                  toast.error(t('error', { defaultValue: 'Operation failed' }));
                }
              },
              title: t('sessionGroup.publishToWorkspace', {
                defaultValue: 'Publish to Workspace',
                ns: 'chat',
              }),
            });
          },
        }
      : null;

    return [
      createAgentItem,
      createGroupChatItem,
      ...(connectAgentItem ? [{ type: 'divider' as const }, connectAgentItem] : []),
      { type: 'divider' as const },
      ...(isCustomGroup
        ? [
            renameItem,
            configItem,
            hideItem,
            ...(publishItem ? [{ type: 'divider' as const }, publishItem] : []),
            { type: 'divider' as const },
            deleteItem,
          ]
        : [configItem]),
    ].filter(Boolean) as MenuProps['items'];
  }, [
    anchor,
    isCustomGroup,
    id,
    isPinned,
    name,
    visibility,
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    configGroupMenuItem,
    renameGroupMenuItem,
    deleteGroupMenuItem,
    openConfigGroupModal,
    setSidebarGroupVisible,
    showPublishAction,
    canEdit,
    refreshAgentList,
    t,
  ]);
};
