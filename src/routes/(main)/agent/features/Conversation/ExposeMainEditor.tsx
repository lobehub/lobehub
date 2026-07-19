'use client';

import { memo } from 'react';

import { useConversationStore } from '@/features/Conversation/store';

import { useExposeMainEditor } from './useExposeMainEditor';

/**
 * Renders nothing — mounts the active composer's editor on `window.__mainEditor`.
 * Must live inside ConversationProvider, which is why ConversationArea can't call the hook
 * directly from its own body.
 */
const ExposeMainEditor = memo(() => {
  useExposeMainEditor(useConversationStore((s) => s.editor));

  return null;
});

ExposeMainEditor.displayName = 'ExposeMainEditor';

export default ExposeMainEditor;
