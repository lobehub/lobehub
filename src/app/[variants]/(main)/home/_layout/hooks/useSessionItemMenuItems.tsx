import { SessionDefaultGroup } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type ItemType } from 'antd/es/menu/interface';
import isEqual from 'fast-deep-equal';
import {
  Check,
  FolderInputIcon,
  LucideCopy,
  LucidePlus,
  Pen,
  PictureInPicture2Icon,
  Pin,
  PinOff,
  Trash,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

const styles = createStaticStyles(({ css }) => ({
  modalRoot: css`
    z-index: 2000;
  `,
}));

/**
 * Hook for generating menu items for individual session/agent items
 * Used in List/Item/Actions.tsx
 */
export const useSessionItemMenuItems = () => {
  const { t } = useTranslation('chat');
  const { modal, message } = App.useApp();

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);
  const sessionCustomGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);

  const [pinAgent, pinAgentGroup, duplicateAgent, updateAgentGroup, removeAgent, removeAgentGroup] =
    useHomeStore((s) => [
      s.pinAgent,
      s.pinAgentGroup,
      s.duplicateAgent,
      s.updateAgentGroup,
      s.removeAgent,
      s.removeAgentGroup,
    ]);

  /**
   * Pin/Unpin menu item
   */
  const pinMenuItem = useCallback(
    (id: string, isPinned: boolean, parentType: 'agent' | 'group'): ItemType => {
      const iconElement = <Icon icon={isPinned ? PinOff : Pin} />;
      return {
        icon: iconElement,
        key: 'pin',
        label: t(isPinned ? 'pinOff' : 'pin'),
        onClick: () => {
          if (parentType === 'group') {
            pinAgentGroup(id, !isPinned);
          } else {
            pinAgent(id, !isPinned);
          }
        },
      };
    },
    [t, pinAgentGroup, pinAgent],
  );

  /**
   * Rename session menu item
   */
  const renameMenuItem = useCallback(
    (onToggleEdit: (visible?: boolean) => void): ItemType => {
      const iconElement = <Icon icon={Pen} />;
      return {
        icon: iconElement,
        key: 'rename',
        label: t('rename', { ns: 'common' }),
        onClick: (info: any) => {
          info.domEvent?.stopPropagation();
          onToggleEdit(true);
        },
      };
    },
    [t],
  );

  /**
   * Duplicate session menu item
   */
  const duplicateMenuItem = useCallback(
    (id: string): ItemType => {
      const iconElement = <Icon icon={LucideCopy} />;
      return {
        icon: iconElement,
        key: 'duplicate',
        label: t('duplicate', { ns: 'common' }),
        onClick: ({ domEvent }: any) => {
          domEvent.stopPropagation();
          duplicateAgent(id);
        },
      };
    },
    [t, duplicateAgent],
  );

  /**
   * Open in new window menu item
   * Desktop: Opens in a new electron window
   * Browser: Opens in a popup window
   */
  const openInNewWindowMenuItem = useCallback(
    (id: string): ItemType => {
      const iconElement = <Icon icon={PictureInPicture2Icon} />;
      return {
        icon: iconElement,
        key: 'openInNewWindow',
        label: t('openInNewWindow'),
        onClick: ({ domEvent }: any) => {
          domEvent.stopPropagation();
          openAgentInNewWindow(id);
        },
      };
    },
    [t, openAgentInNewWindow],
  );

  /**
   * Move to group submenu item
   * Contains all custom groups, default list, and create new group option
   */
  const moveToGroupMenuItem = useCallback(
    (
      id: string,
      currentGroup: string | undefined,
      onOpenCreateGroupModal: () => void,
    ): ItemType => {
      const isDefault = currentGroup === SessionDefaultGroup.Default;

      const children = [
        ...sessionCustomGroups.map(({ id: groupId, name }) => {
          const checkIcon = currentGroup === groupId ? <Icon icon={Check} /> : <div />;
          return {
            icon: checkIcon,
            key: groupId,
            label: name,
            onClick: () => {
              updateAgentGroup(id, groupId);
            },
          };
        }),
        {
          icon: isDefault ? <Icon icon={Check} /> : <div />,
          key: 'defaultList',
          label: t('defaultList'),
          onClick: () => {
            updateAgentGroup(id, SessionDefaultGroup.Default);
          },
        },
        {
          type: 'divider' as const,
        },
        {
          icon: <Icon icon={LucidePlus} />,
          key: 'createGroup',
          label: <div>{t('sessionGroup.createGroup')}</div>,
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            onOpenCreateGroupModal();
          },
        },
      ];

      const folderIcon = <Icon icon={FolderInputIcon} />;
      return {
        children,
        icon: folderIcon,
        key: 'moveGroup',
        label: t('sessionGroup.moveGroup'),
      };
    },
    [t, sessionCustomGroups, updateAgentGroup],
  );

  /**
   * Delete menu item with confirmation modal
   * Handles both session and group types
   */
  const deleteMenuItem = useCallback(
    (id: string, parentType: 'agent' | 'group', sessionType?: string): ItemType => {
      const trashIcon = <Icon icon={Trash} />;
      return {
        danger: true,
        icon: trashIcon,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: ({ domEvent }: any) => {
          domEvent.stopPropagation();
          modal.confirm({
            centered: true,
            classNames: {
              root: styles.modalRoot,
            },
            okButtonProps: { danger: true },
            onOk: async () => {
              if (parentType === 'group') {
                await removeAgentGroup(id);
                message.success(t('confirmRemoveGroupSuccess'));
              } else {
                await removeAgent(id);
                message.success(t('confirmRemoveSessionSuccess'));
              }
            },
            title:
              sessionType === 'group'
                ? t('confirmRemoveChatGroupItemAlert')
                : t('confirmRemoveSessionItemAlert'),
          });
        },
      };
    },
    [t, modal, styles.modalRoot, removeAgentGroup, message, removeAgent],
  );

  return {
    deleteMenuItem,
    duplicateMenuItem,
    moveToGroupMenuItem,
    openInNewWindowMenuItem,
    pinMenuItem,
    renameMenuItem,
  };
};
