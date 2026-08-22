'use client';

import { AcceptanceViewer, OriginConversationProvider } from '@/features/Verify';
import TopicPanel from '@/features/Verify/Acceptance/TopicPanel';

export default function AcceptanceRoute() {
  return (
    <OriginConversationProvider TopicPanel={TopicPanel}>
      <AcceptanceViewer />
    </OriginConversationProvider>
  );
}
