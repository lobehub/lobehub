'use client';

import { type MenuProps } from '@lobehub/ui';
import { Flexbox, Hotkey, Icon } from '@lobehub/ui';
import { BotMessageSquare, LucideCheck, MessageSquarePlus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useConversationStore, useConversationStoreApi } from '@/features/Conversation';
import { useUserStore } from '@/store/user';
import { preferenceSelectors, settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum, KeyEnum } from '@/types/hotkey';

/**
 * useSendMenuItems hook for ConversationStore
 *
 * Provides send menu items for:
 * - Send with Enter / Cmd+Enter toggle
 * - Add AI Message
 * - Add User Message
 */
export const useSendMenuItems = (): MenuProps['items'] => {
  const { t } = useTranslation('chat');

  const storeApi = useConversationStoreApi();
  const editor = useConversationStore((s) => s.editor);

  const [useCmdEnterToSend, updatePreference] = useUserStore((s) => [
    preferenceSelectors.useCmdEnterToSend(s),
    s.updatePreference,
  ]);

  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.AddUserMessage));

  const handleAddAIMessage = useCallback(() => {
    const store = storeApi.getState();
    // Add empty AI message placeholder
    store.addAIMessage('');
    // Clear and focus editor
    editor?.clearContent();
    editor?.focus();
  }, [storeApi, editor]);

  const handleAddUserMessage = useCallback(() => {
    const store = storeApi.getState();
    const message = store.inputMessage;
    if (!message.trim()) return;

    store.addUserMessage({ message });
    // Clear and focus editor
    editor?.clearContent();
    editor?.focus();
  }, [storeApi, editor]);

  return useMemo(
    () => [
      {
        icon: !useCmdEnterToSend ? <Icon icon={LucideCheck} /> : <div />,
        key: 'sendWithEnter',
        label: (
          <Flexbox horizontal align={'center'} gap={4}>
            <Trans
              i18nKey={'input.sendWithEnter'}
              ns={'chat'}
              components={{
                key: <Hotkey keys={KeyEnum.Enter} variant={'borderless'} />,
              }}
            />
          </Flexbox>
        ),
        onClick: () => {
          updatePreference({ useCmdEnterToSend: false });
        },
      },
      {
        icon: useCmdEnterToSend ? <Icon icon={LucideCheck} /> : <div />,
        key: 'sendWithCmdEnter',
        label: (
          <Flexbox horizontal align={'center'} gap={4}>
            <Trans
              i18nKey={'input.sendWithCmdEnter'}
              ns={'chat'}
              components={{
                key: (
                  <Hotkey keys={[KeyEnum.Mod, KeyEnum.Enter].join('+')} variant={'borderless'} />
                ),
              }}
            />
          </Flexbox>
        ),
        onClick: () => {
          updatePreference({ useCmdEnterToSend: true });
        },
      },
      { type: 'divider' },
      {
        icon: <Icon icon={BotMessageSquare} />,
        key: 'addAi',
        label: t('input.addAi'),
        onClick: handleAddAIMessage,
      },
      {
        icon: <Icon icon={MessageSquarePlus} />,
        key: 'addUser',
        label: (
          <Flexbox horizontal align={'center'} gap={24}>
            {t('input.addUser')}
            <Hotkey keys={hotkey} />
          </Flexbox>
        ),
        onClick: handleAddUserMessage,
      },
    ],
    [useCmdEnterToSend, updatePreference, hotkey, handleAddAIMessage, handleAddUserMessage],
  );
};
