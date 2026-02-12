import { type ActionIconGroupItemType } from '@lobehub/ui';
import { copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import {
  Copy,
  Edit,
  ListChevronsDownUp,
  ListRestart,
  RotateCcw,
  Share2,
  Trash,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type UIChatMessage } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';

export interface ActionItem extends ActionIconGroupItemType {
  children?: Array<{ handleClick?: () => void; key: string; label: string }>;
  handleClick?: () => void | Promise<void>;
}

export interface AssistantActions {
  collapse: ActionItem;
  copy: ActionItem;
  del: ActionItem;
  divider: { type: 'divider' };
  edit: ActionItem;
  regenerate: ActionItem;
  share: ActionItem;
}

interface UseAssistantActionsParams {
  data: UIChatMessage;
  id: string;
  index: number;
  onOpenShareModal?: () => void;
}

export const useAssistantActions = ({
  id,
  data,
  onOpenShareModal,
}: UseAssistantActionsParams): AssistantActions => {
  const { t } = useTranslation(['common', 'chat']);
  const { message } = App.useApp();

  // Get state from ConversationStore
  const isCollapsed = useConversationStore(messageStateSelectors.isMessageCollapsed(id));
  const isRegenerating = useConversationStore(messageStateSelectors.isMessageRegenerating(id));

  // Get actions from ConversationStore
  const [
    toggleMessageEditing,
    toggleMessageCollapsed,
    deleteMessage,
    regenerateAssistantMessage,
    translateMessage,
    ttsMessage,
    delAndRegenerateMessage,
  ] = useConversationStore((s) => [
    s.toggleMessageEditing,
    s.toggleMessageCollapsed,
    s.deleteMessage,
    s.regenerateAssistantMessage,
    s.translateMessage,
    s.ttsMessage,
    s.delAndRegenerateMessage,
  ]);

  return useMemo<AssistantActions>(
    () => ({
      collapse: {
        handleClick: () => toggleMessageCollapsed(id),
        icon: ListChevronsDownUp,
        key: 'collapse',
        label: t('messageAction.collapse', { ns: 'chat' }),
      },
      copy: {
        handleClick: async () => {
          await copyToClipboard(data.content);
          message.success(t('copySuccess'));
        },
        icon: Copy,
        key: 'copy',
        label: t('copy'),
      },
      del: {
        danger: true,
        handleClick: () => deleteMessage(id),
        icon: Trash,
        key: 'del',
        label: t('delete'),
      },
      delAndRegenerate: {
        disabled: isRegenerating,
        handleClick: () => delAndRegenerateMessage(id),
        icon: ListRestart,
        key: 'delAndRegenerate',
        label: t('messageAction.delAndRegenerate', { ns: 'chat' }),
      },
      divider: {
        type: 'divider',
      },
      edit: {
        handleClick: () => {
          toggleMessageEditing(id, true);
        },
        icon: Edit,
        key: 'edit',
        label: t('edit'),
      },
      regenerate: {
        disabled: isRegenerating,
        handleClick: () => {
          regenerateAssistantMessage(id);
          if (data.error) deleteMessage(id);
        },
        icon: RotateCcw,
        key: 'regenerate',
        label: t('regenerate'),
        spin: isRegenerating || undefined,
      },
      share: {
        handleClick: onOpenShareModal,
        icon: Share2,
        key: 'share',
        label: t('share'),
      },
    }),
    [
      t,
      id,
      data.content,
      data.error,
      isRegenerating,
      isCollapsed,
      toggleMessageEditing,
      deleteMessage,
      regenerateAssistantMessage,
      translateMessage,
      ttsMessage,
      delAndRegenerateMessage,
      toggleMessageCollapsed,
      onOpenShareModal,
      message,
    ],
  );
};
