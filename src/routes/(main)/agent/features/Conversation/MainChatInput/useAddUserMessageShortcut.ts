'use client';

import { useCallback } from 'react';

import { useConversationStore, useConversationStoreApi } from '@/features/Conversation';
import { useAddUserMessageHotkey } from '@/hooks/useHotkeys';

/**
 * Binds the "add user message" hotkey: appends the composer text as a user
 * message without asking the agent to reply.
 */
export const useAddUserMessageShortcut = () => {
  const storeApi = useConversationStoreApi();
  const editor = useConversationStore((s) => s.editor);

  const handleAddUserMessage = useCallback(() => {
    const store = storeApi.getState();
    const message = store.inputMessage;
    if (!message.trim()) return;

    store.addUserMessage({ message });
    editor?.clearContent();
    editor?.focus();
  }, [storeApi, editor]);

  useAddUserMessageHotkey(handleAddUserMessage);
};
