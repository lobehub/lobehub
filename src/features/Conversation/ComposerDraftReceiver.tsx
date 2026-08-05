'use client';

import { memo, useEffect } from 'react';

import { useComposerDraftBus } from './composerDraftBus';
import { useConversationStore } from './store';

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
  const draft = useComposerDraftBus((s) => s.draft);

  useEffect(() => {
    useComposerDraftBus.setState({ attached: Boolean(editor) });
    return () => {
      useComposerDraftBus.setState({ attached: false });
    };
  }, [editor]);

  useEffect(() => {
    if (!draft || !editor) return;
    // setDocument alone does not fire the change handler that keeps
    // inputMessage in sync — Send would stay disabled (see restoreToInput).
    editor.setDocument('markdown', draft.text);
    updateInputMessage(draft.text);
    editor.focus();
    useComposerDraftBus.setState({ draft: null });
  }, [draft, editor, updateInputMessage]);

  return null;
});

ComposerDraftReceiver.displayName = 'ComposerDraftReceiver';

export default ComposerDraftReceiver;
