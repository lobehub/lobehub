'use client';

import { memo, useEffect } from 'react';

import { readDocument } from '@/features/ChatInput/editorDocument';

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
  const agentId = useConversationStore((s) => s.context.agentId);
  const topicId = useConversationStore((s) => s.context.topicId);
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
    // Right after navigating, the conversation still points at the previously
    // active topic; switching away clears the input. Wait for the new topic.
    if (draft.target && (draft.target.agentId !== agentId || topicId)) return;
    // Keep what the user typed as is (indentation, Markdown line breaks); only
    // an all-blank input counts as empty.
    // Read the editor itself: `inputMessage` trails it behind a debounce, and
    // the last few typed characters would be overwritten.
    const live = draft.append ? readDocument(editor, 'markdown') : undefined;
    const current = typeof live === 'string' ? live : storeApi.getState().inputMessage;
    const text = draft.append && current.trim() ? `${current}\n\n${draft.text}` : draft.text;
    // setDocument alone does not fire the change handler that keeps
    // inputMessage in sync — Send would stay disabled (see restoreToInput).
    editor.setDocument('markdown', text);
    updateInputMessage(text);
    editor.focus();
    useComposerDraftBus.setState({ draft: null });
  }, [agentId, draft, editor, storeApi, topicId, updateInputMessage]);

  return null;
});

ComposerDraftReceiver.displayName = 'ComposerDraftReceiver';

export default ComposerDraftReceiver;
