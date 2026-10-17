import { isDesktop } from '@lobechat/const';
import { HotkeyEnum, HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { useEffect } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import { useActionSWR } from '@/libs/swr';
import { topicActionKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

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

/**
 * `enabled` defaults to the desktop gate, where a local shell always exists.
 * The web build passes its own condition — there the panel can only open once a
 * device is connected, so the binding must stay off until one is.
 */
export const useToggleTerminalPanelHotkey = (enabled: boolean = isDesktop) => {
  const toggleTerminalPanel = useGlobalStore((s) => s.toggleTerminalPanel);

  return useHotkeyById(HotkeyEnum.ToggleTerminalPanel, () => toggleTerminalPanel(), {
    enableOnContentEditable: true,
    enabled,
  });
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
