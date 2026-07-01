import { type SidebarVisibility } from '@lobechat/types';
import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { GlobeIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';
import { useHomeStore } from '@/store/home';

import { useCreateMenuItems, useSessionGroupMenuItems } from '../../../../hooks';

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
  const { message } = App.useApp();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);

  // Session group menu items
  const { renameGroupMenuItem, configGroupMenuItem, deleteGroupMenuItem } =
    useSessionGroupMenuItems();

  // Create menu items
  const { createAgentMenuItem, createGroupChatMenuItem } = useCreateMenuItems();

  // "Publish to Workspace" is one-way and only meaningful in workspace mode
  // for the creator's own still-private folder. Once a folder is `public`,
  // members may have anchored their own work to it, so it can't be
  // re-privatized. The server enforces both rules; the UI just hides the
  // entry when it would never succeed.
  const activeWorkspaceId = useActiveWorkspaceId();
  const isPrivate = visibility === 'private';
  const showPublishAction = Boolean(activeWorkspaceId && id && isCustomGroup) && isPrivate;

  return useMemo(() => {
    const createAgentItem = createAgentMenuItem({ groupId: id, isPinned, visibility });
    const createGroupChatItem = createGroupChatMenuItem({ groupId: id, visibility });
    const configItem = configGroupMenuItem(openConfigGroupModal);
    const renameItem = id && name ? renameGroupMenuItem(id, name, anchor) : null;
    const deleteItem = id ? deleteGroupMenuItem(id) : null;
    const publishItem = showPublishAction
      ? {
          disabled: !canEdit,
          icon: <Icon icon={GlobeIcon} />,
          key: 'publishToWorkspace',
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
                  message.success(
                    t('sessionGroup.publishToWorkspaceSuccess', {
                      defaultValue: 'Published to workspace',
                      ns: 'chat',
                    }),
                  );
                } catch (error) {
                  console.error('Failed to publish group:', error);
                  message.error(t('error', { defaultValue: 'Operation failed' }));
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
      { type: 'divider' as const },
      ...(isCustomGroup
        ? [
            renameItem,
            configItem,
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
    createGroupChatMenuItem,
    configGroupMenuItem,
    renameGroupMenuItem,
    deleteGroupMenuItem,
    openConfigGroupModal,
    showPublishAction,
    canEdit,
    message,
    refreshAgentList,
    t,
  ]);
};
