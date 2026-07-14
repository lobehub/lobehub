import { useEffect } from 'react';

import { type ChatInputEditor } from '@/features/ChatInput';

/**
 * Exposes this page's chat input editor as `window.__mainEditor`, mirroring `window.__editor`
 * for the canvas editor. Scoped to MainChatInput on purpose: other chat inputs (follow-up,
 * AgentBuilder, home) must not claim the handle, so it always points at the main composer.
 */
export const useExposeMainEditor = (editor: ChatInputEditor | null) => {
  useEffect(() => {
    if (!editor) return;

    window.__mainEditor = editor;

    return () => {
      window.__mainEditor = undefined;
    };
  }, [editor]);
};
