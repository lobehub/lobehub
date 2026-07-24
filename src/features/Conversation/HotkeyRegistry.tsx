'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { type UIChatMessage } from '@lobechat/types';
import { memo } from 'react';

import { useHotkeyById } from '@/hooks/useHotkeys/useHotkeyById';
import { usePermission } from '@/hooks/usePermission';

import { useConversationHotkeyStore } from './hotkeyStore';
import { useConversationStore } from './store';

interface HotkeyRegistryProps {
  conversationKey: string;
}

interface RegenerateTarget {
  id: string;
  role: 'assistant' | 'assistantGroup' | 'user';
}

const canControlMessage = (
  item: UIChatMessage,
): item is UIChatMessage & { role: RegenerateTarget['role'] } =>
  item.id !== 'default' &&
  (item.role === 'assistant' || item.role === 'assistantGroup' || item.role === 'user');

/**
 * Registers conversation-level hotkeys within the ConversationProvider context.
 *
 * These hotkeys need access to the local ConversationStore which is only available
 * within the ConversationProvider, so they cannot be registered globally in chatScope.ts.
 *
 * When inside a thread, skip parent messages (threadId is null/undefined).
 * A parent message is a main-conversation message shown above the divider
 * for context and must not be deleted or regenerated via thread hotkeys.
 */
const getLastRegenerateTarget = (
  displayMessages: UIChatMessage[],
  activeThreadId: string | null | undefined,
): RegenerateTarget | undefined => {
  for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
    const item = displayMessages[index];

    // In thread context: skip parent messages (those without a matching threadId)
    if (activeThreadId && item.threadId !== activeThreadId) continue;

    if (canControlMessage(item)) {
      return {
        id: item.id,
        role: item.role,
      };
    }
  }

  return undefined;
};

const getLastMessageId = (
  displayMessages: UIChatMessage[],
  activeThreadId: string | null | undefined,
) => {
  if (activeThreadId) {
    // Only consider thread-owned messages; skip parent messages
    for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
      const item = displayMessages[index];
      if (item.threadId === activeThreadId && canControlMessage(item)) return item.id;
    }
    return undefined;
  }

  return displayMessages.findLast(canControlMessage)?.id;
};

const HotkeyRegistry = memo<HotkeyRegistryProps>(({ conversationKey }) => {
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [
    deleteMessage,
    delAndRegenerateMessage,
    displayMessages,
    regenerateAssistantMessage,
    regenerateUserMessage,
  ] = useConversationStore((s) => [
    s.deleteMessage,
    s.delAndRegenerateMessage,
    s.displayMessages,
    s.regenerateAssistantMessage,
    s.regenerateUserMessage,
  ]);
  // Retrieve the threadId from the conversation context so we can skip
  // parent (main-conversation) messages when operating inside a thread.
  const activeThreadId = useConversationStore((s) => s.context.threadId);
  const isActive = useConversationHotkeyStore((s) => s.activeConversationKey === conversationKey);
  const canDelete = isActive && canEdit;
  const canRegenerate = isActive && canCreate;

  useHotkeyById(
    HotkeyEnum.RegenerateMessage,
    () => {
      const target = getLastRegenerateTarget(displayMessages, activeThreadId);

      if (!target) return;

      if (target.role === 'user') {
        void regenerateUserMessage(target.id);
        return;
      }

      void regenerateAssistantMessage(target.id);
    },
    { enableOnContentEditable: true, enabled: canRegenerate },
    [
      activeThreadId,
      canRegenerate,
      displayMessages,
      regenerateAssistantMessage,
      regenerateUserMessage,
    ],
  );

  useHotkeyById(
    HotkeyEnum.DeleteLastMessage,
    () => {
      const id = getLastMessageId(displayMessages, activeThreadId);

      if (id) void deleteMessage(id);
    },
    { enableOnContentEditable: true, enabled: canDelete },
    [activeThreadId, canDelete, deleteMessage, displayMessages],
  );

  useHotkeyById(
    HotkeyEnum.DeleteAndRegenerateMessage,
    () => {
      const target = getLastRegenerateTarget(displayMessages, activeThreadId);

      if (!target) return;

      if (target.role === 'user') {
        void regenerateUserMessage(target.id);
        return;
      }

      void delAndRegenerateMessage(target.id);
    },
    { enableOnContentEditable: true, enabled: canRegenerate },
    [
      activeThreadId,
      canRegenerate,
      delAndRegenerateMessage,
      displayMessages,
      regenerateUserMessage,
    ],
  );

  return null;
});

HotkeyRegistry.displayName = 'ConversationHotkeyRegistry';

export default HotkeyRegistry;
