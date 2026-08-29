import { memo } from 'react';

import { AcceptanceViewer, OriginConversationProvider } from '@/features/Acceptance';
import TopicPanel from '@/features/Acceptance/Viewer/TopicPanel';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const acceptanceId = useChatStore(chatPortalSelectors.acceptancePortalId);

  return (
    <OriginConversationProvider TopicPanel={TopicPanel}>
      <AcceptanceViewer acceptanceId={acceptanceId} />
    </OriginConversationProvider>
  );
});

export default Body;
