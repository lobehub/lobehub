import { HotkeyEnum, HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { useEffect } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import { useActionSWR } from '@/libs/swr';
import { topicActionKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';

import { useHotkeyById } from './useHotkeyById';

export const useSaveTopicHotkey = () => {
  const openNewTopicOrSaveTopic = useChatStore((s) => s.openNewTopicOrSaveTopic);
  const { mutate } = useActionSWR(topicActionKeys.openNewOrSave(), openNewTopicOrSaveTopic);
  return useHotkeyById(HotkeyEnum.SaveTopic, () => mutate(), { enableOnContentEditable: true });
};

export const useOpenChatSettingsHotkey = () => {
  const openChatSettings = useOpenChatSettings();
  return useHotkeyById(HotkeyEnum.OpenChatSettings, openChatSettings);
};

// Note: useRegenerateMessageHotkey has been moved to ConversationStore
// Note: useDeleteAndRegenerateMessageHotkey has been moved to ConversationStore
// Note: useDeleteLastMessageHotkey has been moved to ConversationStore

export const useAddUserMessageHotkey = (send: () => void) => {
  return useHotkeyById(
    HotkeyEnum.AddUserMessage,
    () => {
      send();
    },
    {
      enableOnContentEditable: true,
    },
  );
};

// Register aggregate

export const useRegisterChatHotkeys = () => {
  const { enableScope, disableScope } = useHotkeysContext();

  // System
  useOpenChatSettingsHotkey();

  // Conversation
  // Note: Regenerate and delete hotkeys have been moved to ConversationStore
  useSaveTopicHotkey();

  useEffect(() => {
    enableScope(HotkeyScopeEnum.Chat);
    return () => disableScope(HotkeyScopeEnum.Chat);
  }, []);
};
