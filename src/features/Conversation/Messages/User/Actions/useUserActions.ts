import { type ActionIconGroupItemType } from '@lobehub/ui';
import { copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import { Copy, Edit, LanguagesIcon, Play, RotateCcw, Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { localeOptions } from '@/locales/resources';
import { type UIChatMessage } from '@/types/index';

import { messageStateSelectors, useConversationStore } from '../../../store';

export interface ActionItem extends ActionIconGroupItemType {
  children?: Array<{ handleClick?: () => void; key: string; label: string }>;
  handleClick?: () => void | Promise<void>;
}

export interface UserActions {
  copy: ActionItem;
  del: ActionItem;
  divider: { type: 'divider' };
  edit: ActionItem;
  regenerate: ActionItem;
  translate: ActionItem;
  tts: ActionItem;
}

interface UseUserActionsParams {
  data: UIChatMessage;
  id: string;
}

export const useUserActions = ({ id, data }: UseUserActionsParams): UserActions => {
  const { t } = useTranslation('common');
  const { message } = App.useApp();

  // Get state from ConversationStore
  const isRegenerating = useConversationStore(messageStateSelectors.isMessageRegenerating(id));

  // Get actions from ConversationStore
  const [toggleMessageEditing, deleteMessage, regenerateUserMessage, translateMessage, ttsMessage] =
    useConversationStore((s) => [
      s.toggleMessageEditing,
      s.deleteMessage,
      s.regenerateUserMessage,
      s.translateMessage,
      s.ttsMessage,
    ]);

  return useMemo<UserActions>(
    () => ({
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
          regenerateUserMessage(id);
          if (data.error) deleteMessage(id);
        },
        icon: RotateCcw,
        key: 'regenerate',
        label: t('regenerate'),
        spin: isRegenerating || undefined,
      },
      translate: {
        children: localeOptions.map((i) => ({
          key: i.value,
          label: t(`lang.${i.value}`),
          onClick: () => translateMessage(id, i.value),
        })),
        icon: LanguagesIcon,
        key: 'translate',
        label: t('translate.action', { ns: 'chat' }),
      },
      tts: {
        handleClick: () => ttsMessage(id),
        icon: Play,
        key: 'tts',
        label: t('tts.action', { ns: 'chat' }),
      },
    }),
    [
      t,
      id,
      data.content,
      data.error,
      isRegenerating,
      toggleMessageEditing,
      deleteMessage,
      regenerateUserMessage,
      translateMessage,
      ttsMessage,
      message,
    ],
  );
};
