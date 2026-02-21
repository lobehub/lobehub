import { useEffect } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { useClearCurrentMessages } from '@/features/ChatInput/ActionBar/Clear';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import { useActionSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { HotkeyEnum, HotkeyScopeEnum } from '@/types/hotkey';

import { useHotkeyById } from './useHotkeyById';

export const useSaveTopicHotkey = () => {
  const openNewTopicOrSaveTopic = useChatStore((s) => s.openNewTopicOrSaveTopic);
  const { mutate } = useActionSWR('openNewTopicOrSaveTopic', openNewTopicOrSaveTopic);
  return useHotkeyById(HotkeyEnum.SaveTopic, () => mutate(), { enableOnContentEditable: true });
};

export const useToggleZenModeHotkey = () => {
  const toggleZenMode = useGlobalStore((s) => s.toggleZenMode);
  return useHotkeyById(HotkeyEnum.ToggleZenMode, toggleZenMode, { enableOnContentEditable: true });
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

export const useClearCurrentMessagesHotkey = () => {
  const clearCurrentMessages = useClearCurrentMessages();
  return useHotkeyById(HotkeyEnum.ClearCurrentMessages, () => clearCurrentMessages(), {
    enableOnContentEditable: true,
  });
};

// Register aggregate

export const useRegisterChatHotkeys = () => {
  const { enableScope, disableScope } = useHotkeysContext();

  // System
  useOpenChatSettingsHotkey();

  // Layout
  useToggleZenModeHotkey();

  // Conversation
  // Note: Regenerate and delete hotkeys have been moved to ConversationStore
  useSaveTopicHotkey();
  useClearCurrentMessagesHotkey();

  useEffect(() => {
    enableScope(HotkeyScopeEnum.Chat);
    return () => disableScope(HotkeyScopeEnum.Chat);
  }, []);
};
