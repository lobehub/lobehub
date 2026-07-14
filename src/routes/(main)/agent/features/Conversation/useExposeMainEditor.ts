import { useEffect } from 'react';

import { type ChatInputEditor } from '@/features/ChatInput';

/**
 * Exposes the conversation's chat input editor as `window.__mainEditor`, mirroring
 * `window.__editor` for the canvas editor.
 *
 * Called from the conversation level so it covers both composers — MainChatInput and
 * HeterogeneousChatInput. Deliberately not mounted inside the shared
 * `features/Conversation/ChatInput`: AgentBuilder and FloatingChatPanel render that same input,
 * and letting them claim the handle would leave it pointing at whichever mounted last.
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
