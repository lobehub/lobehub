import PortalPanel from '@/routes/(main)/agent/features/Portal/features/PortalPanel';
import ConversationArea from '@/routes/(main)/group/features/Conversation/ConversationArea';
import TelemetryNotification from '@/routes/(main)/group/features/TelemetryNotification';

import { MobileGroupTopics } from './Topics';

export const MobileGroupChat = () => (
  <>
    <ConversationArea mobile />
    <MobileGroupTopics />
    <PortalPanel mobile />
    <TelemetryNotification mobile />
  </>
);
