'use client';

import { memo } from 'react';

import { useHotkeyById } from '@/hooks/useHotkeys/useHotkeyById';
import { HotkeyEnum } from '@/types/hotkey';

import { useConversationStore } from './store';

/**
 * Registers conversation-level hotkeys within the ConversationProvider context.
 *
 * These hotkeys need access to the local ConversationStore which is only available
 * within the ConversationProvider, so they cannot be registered globally in chatScope.ts.
 */
const HotkeyRegistry = memo(() => {
  const displayMessages = useConversationStore((s) => s.displayMessages);
  const regenerateAssistantMessage = useConversationStore((s) => s.regenerateAssistantMessage);
  const deleteMessage = useConversationStore((s) => s.deleteMessage);
  const delAndRegenerateMessage = useConversationStore((s) => s.delAndRegenerateMessage);

  // Find the last assistant message for regenerate operations
  const getLastAssistantMessageId = () => {
    // Iterate backwards to find the last assistant message
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg = displayMessages[i];
      if (msg.role === 'assistant' || msg.role === 'assistantGroup') {
        return msg.id;
      }
    }
    return null;
  };

  // Get the last message (any type) for delete operations
  const getLastMessageId = () => {
    if (displayMessages.length === 0) return null;
    const lastMessage = displayMessages.at(-1);
    return lastMessage?.id ?? null;
  };

  // Alt+R: Regenerate last assistant message
  useHotkeyById(
    HotkeyEnum.RegenerateMessage,
    () => {
      const messageId = getLastAssistantMessageId();
      if (messageId) {
        regenerateAssistantMessage(messageId);
      }
    },
    { enableOnContentEditable: true },
  );

  // Alt+D: Delete last message (any type)
  useHotkeyById(
    HotkeyEnum.DeleteLastMessage,
    () => {
      const messageId = getLastMessageId();
      if (messageId) {
        deleteMessage(messageId);
      }
    },
    { enableOnContentEditable: true },
  );

  // Alt+Shift+R: Delete and regenerate last assistant message
  useHotkeyById(
    HotkeyEnum.DeleteAndRegenerateMessage,
    () => {
      const messageId = getLastAssistantMessageId();
      if (messageId) {
        delAndRegenerateMessage(messageId);
      }
    },
    { enableOnContentEditable: true },
  );

  return null;
});

HotkeyRegistry.displayName = 'ConversationHotkeyRegistry';

export default HotkeyRegistry;
