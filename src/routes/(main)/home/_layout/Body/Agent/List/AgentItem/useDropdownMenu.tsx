import { SessionDefaultGroup, type SidebarVisibility } from '@lobechat/types';
import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import {
  Check,
  FolderInputIcon,
  GlobeIcon,
  LucideCopy,
  LucidePlus,
  Pen,
  PictureInPicture2Icon,
  Pin,
  PinOff,
  Trash,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentTransferMenuItem } from '@/business/client/hooks/useAgentTransferMenuItem';
import { openEditingPopover } from '@/features/EditingPopover/store';
import { usePermission } from '@/hooks/usePermission';
import { agentService } from '@/services/agent';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

interface UseAgentDropdownMenuParams {
  anchor: HTMLElement | null;
  avatar?: string;
  backgroundColor?: string;
  group: string | undefined;
  id: string;
  openCreateGroupModal: () => void;
  pinned: boolean;
  title: string;
  visibility?: SidebarVisibility;
}

export const useAgentDropdownMenu = ({
  anchor,
  avatar,
  backgroundColor,
  group,
  id,
  openCreateGroupModal,
  pinned,
  title,
  visibility,
}: UseAgentDropdownMenuParams): (() => MenuProps['items']) => {
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);
  // Pick the group bucket that matches this agent's visibility so the
  // "Move to group" picker only offers same-scope targets — moving a private
  // agent into a public group (or vice versa) would orphan it from the view
  // it currently lives in.
  const sessionCustomGroups = useHomeStore(
    visibility === 'private'
      ? homeAgentListSelectors.privateAgentGroups
      : homeAgentListSelectors.agentGroups,
    isEqual,
  );
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const [pinAgent, duplicateAgent, updateAgentGroup, removeAgent] = useHomeStore((s) => [
    s.pinAgent,
    s.duplicateAgent,
    s.updateAgentGroup,
    s.removeAgent,
  ]);

  // "Publish to Workspace" is a one-way action and only meaningful inside a
  // workspace: in personal mode every row is implicitly owner-private. Once
  // an agent is `public`, other members may already use it, so we never let
  // it slip back to `private`. The menu item only appears for private
  // agents in workspace mode; the server is the source of truth for whether
  // the viewer is the creator and rejects requests from anyone else.
  const activeWorkspaceId = useActiveWorkspaceId();
  const isPrivate = visibility === 'private';
  const showPublishAction = Boolean(activeWorkspaceId) && isPrivate;

  // Viewer has no write permissions on agents — disable every mutating menu
  // item (pin/rename/duplicate/move/delete) while keeping the menu visible
  // so they can still inspect what actions exist. `openInNewWindow` is a
  // pure read so it stays enabled.
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { allowed: canCreate } = usePermission('create_content');

  // Cross-workspace Transfer to… / Copy to… items (null when workspace feature is off)
  const transferMenuItems = useAgentTransferMenuItem(id, {
    avatar,
    backgroundColor,
    title,
  });

  const isDefault = group === SessionDefaultGroup.Default;

  return useMemo(
    () => () =>
      [
        {
          disabled: !canEdit,
          icon: <Icon icon={pinned ? PinOff : Pin} />,
          key: 'pin',
          label: t(pinned ? 'pinOff' : 'pin'),
          onClick: () => pinAgent(id, !pinned),
        },
        {
          disabled: !canEdit,
          icon: <Icon icon={Pen} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            if (anchor) {
              openEditingPopover({ anchor, avatar, id, title, type: 'agent' });
            }
          },
        },
        {
          disabled: !canCreate,
          icon: <Icon icon={LucideCopy} />,
          key: 'duplicate',
          label: t('duplicate', { ns: 'common' }),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            duplicateAgent(id);
          },
        },
        {
          icon: <Icon icon={PictureInPicture2Icon} />,
          key: 'openInNewWindow',
          label: t('openInNewWindow'),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            openAgentInNewWindow(id);
          },
        },
        { type: 'divider' },
        {
          disabled: !canEdit,
          children: [
            ...sessionCustomGroups.map(({ id: groupId, name }) => ({
              icon: group === groupId ? <Icon icon={Check} /> : <div />,
              key: groupId,
              label: name,
              onClick: () => updateAgentGroup(id, groupId),
            })),
            {
              icon: isDefault ? <Icon icon={Check} /> : <div />,
              key: 'defaultList',
              label: t('defaultList'),
              onClick: () => updateAgentGroup(id, SessionDefaultGroup.Default),
            },
            { type: 'divider' as const },
            {
              icon: <Icon icon={LucidePlus} />,
              key: 'createGroup',
              label: <div>{t('sessionGroup.createGroup')}</div>,
              onClick: ({ domEvent }: any) => {
                domEvent.stopPropagation();
                openCreateGroupModal();
              },
            },
          ],
          icon: <Icon icon={FolderInputIcon} />,
          key: 'moveGroup',
          label: t('sessionGroup.moveGroup'),
        },
        { type: 'divider' },
        ...(transferMenuItems ?? []),
        ...(transferMenuItems?.length ? [{ type: 'divider' as const }] : []),
        ...(showPublishAction
          ? [
              {
                disabled: !canEdit,
                icon: <Icon icon={GlobeIcon} />,
                key: 'publishToWorkspace',
                label: t('agent.publishToWorkspace', { defaultValue: 'Publish to Workspace' }),
                onClick: async ({ domEvent }: any) => {
                  domEvent?.stopPropagation();
                  if (!canEdit) return;
                  // Soft confirm because the action is irreversible: once
                  // teammates start using a published agent, the change
                  // can't be rolled back from the UI.
                  confirmModal({
                    cancelText: t('cancel', { ns: 'common' }),
                    content: t('agent.publishToWorkspaceConfirm', {
                      defaultValue:
                        'Other workspace members will be able to use this agent. ' +
                        'You will not be able to make it private again.',
                    }),
                    okText: t('agent.publishToWorkspace', {
                      defaultValue: 'Publish to Workspace',
                    }),
                    onOk: async () => {
                      try {
                        await agentService.publishAgentToWorkspace(id);
                        await refreshAgentList();
                        message.success(
                          t('agent.publishToWorkspaceSuccess', {
                            defaultValue: 'Published to workspace',
                          }),
                        );
                      } catch (error) {
                        console.error('Failed to publish agent:', error);
                        message.error(
                          t('error', { ns: 'common', defaultValue: 'Operation failed' }),
                        );
                      }
                    },
                    title: t('agent.publishToWorkspace', {
                      defaultValue: 'Publish to Workspace',
                    }),
                  });
                },
              },
              { type: 'divider' as const },
            ]
          : []),
        {
          danger: true,
          disabled: !canEdit,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            confirmModal({
              cancelText: t('cancel', { ns: 'common' }),
              content: t('confirmRemoveSessionItemAlert'),
              okButtonProps: { danger: true },
              okText: t('delete', { ns: 'common' }),
              onOk: async () => {
                await removeAgent(id);
                message.success(t('confirmRemoveSessionSuccess'));
              },
              title: t('delete', { ns: 'common' }),
            });
          },
        },
      ] as MenuProps['items'],
    [
      anchor,
      canCreate,
      canEdit,
      pinned,
      id,
      avatar,
      backgroundColor,
      title,
      sessionCustomGroups,
      group,
      isDefault,
      openCreateGroupModal,
      message,
      transferMenuItems,
      showPublishAction,
      refreshAgentList,
      t,
    ],
  );
};
