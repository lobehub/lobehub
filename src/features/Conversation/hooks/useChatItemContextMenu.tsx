import {
  type ActionIconGroupEvent,
  type ActionIconGroupItemType,
  type DropdownItem,
  type GenericItemType,
} from '@lobehub/ui';
import { createRawModal, showContextMenu } from '@lobehub/ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { type MouseEvent, type ReactNode } from 'react';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { MSG_CONTENT_CLASSNAME } from '@/features/Conversation/ChatItem/components/MessageContent';
import { resolveHeteroErroredStepId } from '@/features/Conversation/Error/heterogeneous';
import { usePermission } from '@/hooks/usePermission';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { type ShareModalProps } from '../components/ShareMessageModal';
import ShareMessageModal from '../components/ShareMessageModal';
import {
  createStore,
  dataSelectors,
  messageStateSelectors,
  Provider,
  useConversationStore,
  useConversationStoreApi,
} from '../store';
import { useChatListActionsBar } from './useChatListActionsBar';

interface ActionMenuItem extends ActionIconGroupItemType {
  children?: { key: string; label: ReactNode }[];
  disable?: boolean;
  popupClassName?: string;
}

type MenuItem = ActionMenuItem | { type: 'divider' };
type ContextMenuEvent = ActionIconGroupEvent & { selectedText?: string };

interface UseChatItemContextMenuProps {
  editing?: boolean;
  id: string;
  inPortalThread: boolean;
  topic?: string | null;
}

export const useChatItemContextMenu = ({
  editing,
  id,
  inPortalThread,
  topic,
}: UseChatItemContextMenuProps) => {
  const contextMenuMode = useUserStore(userGeneralSettingsSelectors.contextMenuMode);
  const { message } = App.useApp();
  const { t } = useTranslation('common');
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const selectedTextRef = useRef<string | undefined>(undefined);

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
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
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
    deleteAssistantMessage,
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
    s.deleteAssistantMessage,
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

    const withPermission = (items: MenuItem[]) =>
      !canEdit
        ? items.filter((item) => 'key' in item && item.key === 'copy')
        : items.map((item) => {
            if ('type' in item && item.type === 'divider') return item;
            if (['edit', 'del'].includes(String(item.key))) return { ...item, disabled: !canEdit };
            if (
              ['branching', 'delAndRegenerate', 'regenerate', 'translate', 'tts'].includes(
                String(item.key),
              )
            ) {
              return { ...item, disabled: !canCreate };
            }
            return item;
          });

    if (role === 'assistant') {
      if (error) {
        return withPermission(
          [edit, copy, divider, del, divider, regenerate].filter(Boolean) as MenuItem[],
        );
      }

      const collapseAction = isCollapsed ? expand : collapse;
      const list: MenuItem[] = [edit, copy, collapseAction];

      if (!inThread && !isGroupSession && isDevMode) list.push(branching);

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

      return withPermission(list.filter(Boolean) as MenuItem[]);
    }

    if (role === 'assistantGroup') {
      if (error) {
        return withPermission(
          [edit, copy, divider, del, divider, regenerate].filter(Boolean) as MenuItem[],
        );
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

      return withPermission(list.filter(Boolean) as MenuItem[]);
    }

    if (role === 'user') {
      const list: MenuItem[] = [edit, copy];

      if (!inThread && isDevMode) list.push(branching);

      list.push(divider, tts, translate, divider, regenerate, del);

      return withPermission(list.filter(Boolean) as MenuItem[]);
    }

    return [];
  }, [
    actionsBar,
    canCreate,
    canEdit,
    error,
    inThread,
    isCollapsed,
    isDevMode,
    isGroupSession,
    role,
  ]);

  const handleShare = useCallback(() => {
    const item = getMessage();
    if (!item || item.role !== 'assistant') return;

    createRawModal(
      (props: ShareModalProps) => (
        <Provider
          createStore={() => {
            const state = storeApi.getState();
            return createStore({
              context: state.context,
              hooks: state.hooks,
              skipFetch: state.skipFetch,
            });
          }}
        >
          <ShareMessageModal {...props} />
        </Provider>
      ),
      {
        message: item,
      },
      { onCloseKey: 'onCancel', openKey: 'open' },
    );
  }, [getMessage, storeApi]);

  const handleAction = useCallback(
    async (action: ContextMenuEvent) => {
      const item = getMessage();
      if (!item) return;

      switch (action.key) {
        case 'edit': {
          if (!canEdit) break;
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
          if (!canEdit) break;
          toggleMessageCollapsed(id);
          break;
        }
        case 'branching': {
          if (!canCreate) break;
          if (!topic) {
            message.warning(t('branchingRequiresSavedTopic'));
            break;
          }
          openThreadCreator(id);
          break;
        }
        case 'del': {
          if (!canEdit) break;
          // Mirrors the action bar's `del`: on a heterogeneous run that only
          // failed on its tail step, drop that step instead of the whole run.
          const erroredStepId = resolveHeteroErroredStepId(item);
          if (erroredStepId) deleteAssistantMessage(erroredStepId);
          else deleteMessage(id);
          break;
        }
        case 'regenerate': {
          if (!canCreate) break;
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
          if (!canCreate) break;
          if (inPortalThread) {
            delAndResendThreadMessage(id);
          } else {
            delAndRegenerateMessage(id);
          }
          break;
        }
        case 'tts': {
          if (!canCreate) break;
          ttsMessage(id);
          break;
        }
        case 'share': {
          if (!canEdit) break;
          handleShare();
          break;
        }
      }

      if (action.keyPath?.[0] === 'translate') {
        if (!canCreate) return;
        const lang = action.keyPath.at(-1);
        if (lang) translateMessage(id, lang);
      }
    },
    [
      copyMessage,
      canCreate,
      canEdit,
      deleteAssistantMessage,
      deleteMessage,
      delAndRegenerateMessage,
      delAndResendThreadMessage,
      getMessage,
      handleShare,
      id,
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
    ],
  );

  const handleMenuClick = useCallback(
    (info: ActionIconGroupEvent) => {
      handleAction({
        ...info,
        selectedText: selectedTextRef.current,
      } as ContextMenuEvent);
    },
    [handleAction],
  );

  const contextMenuItems = useMemo<GenericItemType[]>(() => {
    if (!menuItems) return [];
    return menuItems.filter(Boolean).map((item) => {
      if ('type' in item && item.type === 'divider') return { type: 'divider' as const };

      const actionItem = item as ActionMenuItem;
      const children = actionItem.children?.map((child) => ({
        key: child.key,
        label: child.label,
        onClick: handleMenuClick,
      }));
      const disabled =
        actionItem.disabled ??
        (typeof actionItem.disable === 'boolean' ? actionItem.disable : undefined);

      return {
        children,
        danger: actionItem.danger,
        disabled,
        icon: actionItem.icon,
        key: actionItem.key,
        label: actionItem.label,
        onClick: children ? undefined : handleMenuClick,
      } satisfies DropdownItem;
    });
  }, [handleMenuClick, menuItems]);

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (contextMenuMode === 'disabled') {
        return;
      }

      if (editing) {
        return;
      }

      let target = event.target as HTMLElement;
      let hasMessageId = false;

      while (target && target !== document.body) {
        if (target.className.includes(MSG_CONTENT_CLASSNAME)) {
          hasMessageId = true;
          break;
        }
        target = target.parentElement as HTMLElement;
      }

      if (!hasMessageId || contextMenuItems.length === 0) {
        return;
      }

      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() || '';
      selectedTextRef.current = selectedText;

      // If there's selected text outside of current ChatItem, use native context menu
      if (selectedText && selection?.anchorNode) {
        const isSelectionInCurrentItem = target.contains(selection.anchorNode);

        if (isSelectionInCurrentItem) {
          return;
        }
      }

      event.preventDefault();
      event.stopPropagation();

      showContextMenu(contextMenuItems);
    },
    [contextMenuItems, contextMenuMode, editing],
  );

  return {
    handleContextMenu,
  };
};
