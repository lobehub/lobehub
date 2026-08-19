import { memo, useMemo } from 'react';

import { draftToMainComposer } from '@/features/Conversation/composerDraftBus';
import {
  AcceptanceViewer,
  OriginConversationProvider,
  type OriginConversationSlot,
} from '@/features/Verify';
import TopicPanel from '@/features/Verify/Acceptance/TopicPanel';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTaskStore } from '@/store/task';

const Body = memo(() => {
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);
  const closeTopicDrawer = useTaskStore((s) => s.closeTopicDrawer);

  const originConversation = useMemo<OriginConversationSlot>(
    () => ({ TopicPanel, closeTopicDrawer, openTopicDrawer }),
    [closeTopicDrawer, openTopicDrawer],
  );

  // The portal pane is a layout SIBLING of the conversation column, not a
  // descendant of its ConversationProvider — reading useConversationStore here
  // throws ("no zustand provider as an ancestor") and blanks the page. Drafts
  // go through the global composerDraftBus; ComposerDraftReceiver applies them
  // inside the provider (setDocument + inputMessage sync + focus).
  return (
    <OriginConversationProvider value={originConversation}>
      <AcceptanceViewer acceptanceId={acceptanceId} onDraftToComposer={draftToMainComposer} />
    </OriginConversationProvider>
  );
});

export default Body;
