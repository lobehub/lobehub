import { memo } from 'react';

import { draftToMainComposer } from '@/features/Conversation/composerDraftBus';
import { AcceptanceViewer } from '@/features/Verify';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);

  // The portal pane is a layout SIBLING of the conversation column, not a
  // descendant of its ConversationProvider — reading useConversationStore here
  // throws ("no zustand provider as an ancestor") and blanks the page. Drafts
  // go through the global composerDraftBus; ComposerDraftReceiver applies them
  // inside the provider (setDocument + inputMessage sync + focus).
  return <AcceptanceViewer acceptanceId={acceptanceId} onDraftToComposer={draftToMainComposer} />;
});

export default Body;
