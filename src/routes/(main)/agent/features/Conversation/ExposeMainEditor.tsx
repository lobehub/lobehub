'use client';

import { memo, useEffect } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
import { useChatStore } from '@/store/chat';

import { useExposeMainEditor } from './useExposeMainEditor';

/**
 * Renders nothing — exposes the active main conversation's imperative handles.
 * Must live inside ConversationProvider, which is why ConversationArea can't call the hook
 * directly from its own body.
 */
const ExposeMainEditor = memo(() => {
  useExposeMainEditor(useConversationStore((s) => s.editor));
  const scrollToMessage = useConversationStore((s) => s.scrollToMessage);

  useEffect(() => {
    useChatStore.setState({ mainConversationScrollToMessage: scrollToMessage });

    return () => {
      if (useChatStore.getState().mainConversationScrollToMessage === scrollToMessage) {
        useChatStore.setState({ mainConversationScrollToMessage: null });
      }
    };
  }, [scrollToMessage]);

  return null;
});

ExposeMainEditor.displayName = 'ExposeMainEditor';

export default ExposeMainEditor;
