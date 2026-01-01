'use client';

import { type UIChatMessage } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import type { ActionIconGroupEvent, ActionIconGroupItemType } from '@lobehub/ui';
import { Dropdown, type MenuProps } from 'antd';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  type ComponentType,
  type ReactNode,
  type RefObject,
  isValidElement,
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { VListHandle } from 'virtua';

import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import { useChatListActionsBar } from '../hooks/useChatListActionsBar';
import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  useConversationStoreApi,
} from '../store';
import ShareMessageModal from './ShareMessageModal';

interface ActionMenuItem extends ActionIconGroupItemType {
  children?: { key: string; label: ReactNode }[];
  disable?: boolean;
  popupClassName?: string;
}

type MenuItem = ActionMenuItem | { type: 'divider' };
type ContextMenuEvent = ActionIconGroupEvent & { selectedText?: string };

const styles = createStaticStyles(({ css }) => ({
  contextMenu: css`
    position: fixed;
    z-index: 1000;
    min-width: 160px;

    .ant-dropdown-menu {
      border: none;
      border-radius: 6px;
      box-shadow: 0 4px 12px color-mix(in srgb, black 15%, transparent);
    }
  `,
  trigger: css`
    pointer-events: none;

    position: fixed;

    width: 1px;
    height: 1px;

    opacity: 0;
  `,
}));

interface ContextMenuProps {
  id: string;
  inPortalThread: boolean;
  index: number;
  onClose: () => void;
  position: { x: number; y: number };
  selectedText?: string;
  topic?: string | null;
  virtuaRef?: RefObject<VListHandle | null> | null;
  visible: boolean;
}

const ContextMenu = memo<ContextMenuProps>(
  ({ visible, position, selectedText, id, index, inPortalThread, topic, virtuaRef, onClose }) => {
    const { message } = App.useApp();
    const { t } = useTranslation('common');
    const [shareMessage, setShareMessage] = useState<UIChatMessage | null>(null);
    const [isShareModalOpen, setShareModalOpen] = useState(false);

    const storeApi = useConversationStoreApi();

    const [role, error, isCollapsed, hasThread, isRegenerating] = useConversationStore((s) => {
      const item = dataSelectors.getDisplayMessageById(id)(s);
      return [
        item?.role,
        item?.error,
        messageStateSelectors.isMessageCollapsed(id)(s),
        messageStateSelectors.hasThreadBySourceMsgId(id)(s),
        messageStateSelectors.isMessageRegenerating(id)(s),
      ];
    }, isEqual);

    const isThreadMode = useConversationStore(messageStateSelectors.isThreadMode);
    const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);
    const actionsBar = useChatListActionsBar({ hasThread, isRegenerating });
    const inThread = isThreadMode || inPortalThread;

    const [
      toggleMessageEditing,
      deleteMessage,
      regenerateUserMessage,
      regenerateAssistantMessage,
      translateMessage,
      ttsMessage,
      delAndRegenerateMessage,
      copyMessage,
      openThreadCreator,
      resendThreadMessage,
      delAndResendThreadMessage,
      toggleMessageCollapsed,
    ] = useConversationStore((s) => [
      s.toggleMessageEditing,
      s.deleteMessage,
      s.regenerateUserMessage,
      s.regenerateAssistantMessage,
      s.translateMessage,
      s.ttsMessage,
      s.delAndRegenerateMessage,
      s.copyMessage,
      s.openThreadCreator,
      s.resendThreadMessage,
      s.delAndResendThreadMessage,
      s.toggleMessageCollapsed,
    ]);

    const getMessage = useCallback(
      () => dataSelectors.getDisplayMessageById(id)(storeApi.getState()),
      [id, storeApi],
    );

    const menuItems = useMemo<MenuItem[]>(() => {
      if (!role) return [];

      const {
        branching,
        collapse,
        copy,
        del,
        delAndRegenerate,
        divider,
        edit,
        expand,
        regenerate,
        share,
        translate,
        tts,
      } = actionsBar;

      if (role === 'assistant') {
        if (error) {
          return [edit, copy, divider, del, divider, regenerate].filter(Boolean) as MenuItem[];
        }

        const collapseAction = isCollapsed ? expand : collapse;
        const list: MenuItem[] = [edit, copy, collapseAction];

        if (!inThread && !isGroupSession) list.push(branching);

        list.push(
          divider,
          tts,
          translate,
          divider,
          share,
          divider,
          regenerate,
          delAndRegenerate,
          del,
        );

        return list.filter(Boolean) as MenuItem[];
      }

      if (role === 'assistantGroup') {
        if (error) {
          return [edit, copy, divider, del, divider, regenerate].filter(Boolean) as MenuItem[];
        }

        const collapseAction = isCollapsed ? expand : collapse;
        const list: MenuItem[] = [
          edit,
          copy,
          collapseAction,
          divider,
          share,
          divider,
          regenerate,
          del,
        ];

        return list.filter(Boolean) as MenuItem[];
      }

      if (role === 'user') {
        const list: MenuItem[] = [edit, copy];

        if (!inThread) list.push(branching);

        list.push(divider, tts, translate, divider, regenerate, del);

        return list.filter(Boolean) as MenuItem[];
      }

      return [];
    }, [actionsBar, error, inThread, isCollapsed, isGroupSession, role]);

    const handleShare = useCallback(() => {
      const item = getMessage();
      if (!item || item.role !== 'assistant') return;

      setShareMessage(item);
      setShareModalOpen(true);
    }, [getMessage]);

    const handleShareClose = useCallback(() => {
      setShareModalOpen(false);
      setShareMessage(null);
    }, []);

    const handleAction = useCallback(
      async (action: ContextMenuEvent) => {
        const item = getMessage();
        if (!item) return;

        switch (action.key) {
          case 'edit': {
            toggleMessageEditing(id, true);
            break;
          }
          case 'copy': {
            await copyMessage(id, item.content);
            message.success(t('copySuccess'));
            break;
          }
          case 'expand':
          case 'collapse': {
            toggleMessageCollapsed(id);
            break;
          }
          case 'branching': {
            if (!topic) {
              message.warning(t('branchingRequiresSavedTopic'));
              break;
            }
            openThreadCreator(id);
            break;
          }
          case 'del': {
            deleteMessage(id);
            break;
          }
          case 'regenerate': {
            if (inPortalThread) {
              resendThreadMessage(id);
            } else if (role === 'assistant') {
              regenerateAssistantMessage(id);
            } else {
              regenerateUserMessage(id);
            }

            if (item.error) deleteMessage(id);
            break;
          }
          case 'delAndRegenerate': {
            if (inPortalThread) {
              delAndResendThreadMessage(id);
            } else {
              delAndRegenerateMessage(id);
            }
            break;
          }
          case 'tts': {
            ttsMessage(id);
            break;
          }
          case 'share': {
            handleShare();
            break;
          }
        }

        if (action.keyPath?.at(-1) === 'translate') {
          const lang = action.keyPath[0];
          translateMessage(id, lang);
        }
      },
      [
        copyMessage,
        deleteMessage,
        delAndRegenerateMessage,
        delAndResendThreadMessage,
        getMessage,
        handleShare,
        id,
        index,
        inPortalThread,
        message,
        openThreadCreator,
        regenerateAssistantMessage,
        regenerateUserMessage,
        resendThreadMessage,
        role,
        t,
        toggleMessageCollapsed,
        toggleMessageEditing,
        topic,
        translateMessage,
        ttsMessage,
        virtuaRef,
      ],
    );

    const renderIcon = useCallback((iconComponent: ActionIconGroupItemType['icon']) => {
      if (!iconComponent) return null;

      if (isValidElement(iconComponent)) {
        return <ActionIcon icon={iconComponent} size={'small'} />;
      }

      const IconComponent = iconComponent as ComponentType<{ size?: number }>;

      return <ActionIcon icon={<IconComponent size={16} />} size={'small'} />;
    }, []);

    const dropdownMenuItems = useMemo(() => {
      return (menuItems ?? []).filter(Boolean).map((item) => {
        if ('type' in item && item.type === 'divider') return { type: 'divider' as const };

        const actionItem = item as ActionMenuItem;
        const children = actionItem.children?.map((child) => ({
          key: child.key,
          label: child.label,
        }));
        const disabled =
          actionItem.disabled ??
          (typeof actionItem.disable === 'boolean' ? actionItem.disable : undefined);

        return {
          children,
          danger: actionItem.danger,
          disabled,
          icon: renderIcon(actionItem.icon),
          key: actionItem.key,
          label: actionItem.label,
          popupClassName: actionItem.popupClassName,
        };
      });
    }, [menuItems, renderIcon]);

    const handleMenuClick = useCallback(
      (info: Parameters<NonNullable<MenuProps['onClick']>>[0]) => {
        const event = {
          ...info,
          selectedText,
        } as ContextMenuEvent;

        handleAction(event);
        onClose();
      },
      [handleAction, onClose, selectedText],
    );

    if (!visible || menuItems.length === 0) return null;

    return (
      <>
        {createPortal(
          <>
            <div
              className={styles.trigger}
              style={{
                left: position.x,
                top: position.y,
              }}
            />
            <Dropdown
              menu={{
                items: dropdownMenuItems,
                onClick: handleMenuClick,
              }}
              open={visible}
              placement="bottomLeft"
              trigger={[]}
            >
              <div
                className={styles.contextMenu}
                style={{
                  left: position.x,
                  top: position.y,
                }}
              />
            </Dropdown>
          </>,
          document.body,
        )}
        {shareMessage && (
          <ShareMessageModal
            message={shareMessage}
            onCancel={handleShareClose}
            open={isShareModalOpen}
          />
        )}
      </>
    );
  },
);

ContextMenu.displayName = 'ContextMenu';

export default ContextMenu;
