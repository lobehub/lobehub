import { memo, useCallback } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
import { AcceptanceViewer } from '@/features/Verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);
  // The portal renders beside the live conversation composer (inside its
  // ConversationProvider), so a send-back can draft straight into that composer.
  const editor = useConversationStore((s) => s.editor);
  const updateInputMessage = useConversationStore((s) => s.updateInputMessage);

  // Draft text into the composer AND sync ConversationStore.inputMessage — the
  // send button reads that field, and `editor.setDocument` alone does not fire
  // the change handler that keeps it in sync (see restoreToInput). Returns false
  // when the composer isn't mounted so the caller can skip its success toast.
  const draftToComposer = useCallback(
    (text: string) => {
      if (!editor) return false;
      editor.setDocument('markdown', text);
      updateInputMessage(text);
      editor.focus();
      return true;
    },
    [editor, updateInputMessage],
  );

  return <AcceptanceViewer acceptanceId={acceptanceId} onDraftToComposer={draftToComposer} />;
});

export default Body;
