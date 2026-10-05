'use client';

import { memo, useEffect } from 'react';

import { useComposerDraftBus } from './composerDraftBus';
import { useConversationStore, useConversationStoreApi } from './store';

/**
 * Renders nothing — consumes composerDraftBus drafts into the live composer.
 * Must live inside ConversationProvider (it reads the context store); posters
 * live outside it, which is the whole point of the bus. Mount it once next to
 * ExposeMainEditor in the conversation area, not in the shared ChatInput —
 * AgentBuilder / FloatingChatPanel render that same input and would steal
 * drafts meant for the main conversation.
 */
const ComposerDraftReceiver = memo(() => {
  const editor = useConversationStore((s) => s.editor);
  const updateInputMessage = useConversationStore((s) => s.updateInputMessage);
  const storeApi = useConversationStoreApi();
  const draft = useComposerDraftBus((s) => s.draft);

  useEffect(() => {
    useComposerDraftBus.setState({ attached: Boolean(editor) });
    return () => {
      useComposerDraftBus.setState({ attached: false });
    };
  }, [editor]);

  useEffect(() => {
    if (!draft || !editor) return;
    const current = storeApi.getState().inputMessage.trim();
    const text = draft.append && current ? `${current}\n\n${draft.text}` : draft.text;
    // setDocument alone does not fire the change handler that keeps
    // inputMessage in sync — Send would stay disabled (see restoreToInput).
    editor.setDocument('markdown', text);
    updateInputMessage(text);
    editor.focus();
    useComposerDraftBus.setState({ draft: null });
  }, [draft, editor, storeApi, updateInputMessage]);

  return null;
});

ComposerDraftReceiver.displayName = 'ComposerDraftReceiver';

export default ComposerDraftReceiver;
