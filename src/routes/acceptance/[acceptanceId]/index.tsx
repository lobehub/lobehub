'use client';

import { AcceptanceViewer, OriginConversationProvider } from '@/features/Acceptance';
import TopicPanel from '@/features/Acceptance/Viewer/TopicPanel';

export default function AcceptanceRoute() {
  return (
    <OriginConversationProvider TopicPanel={TopicPanel}>
      <AcceptanceViewer />
    </OriginConversationProvider>
  );
}
