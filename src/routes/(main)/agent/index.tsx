'use client';

import { Flexbox } from '@lobehub/ui';

import Conversation from './features/Conversation';
import ChatHydration from './features/Conversation/ChatHydration';
import TelemetryNotification from './features/TelemetryNotification';

const ChatPage = () => {
  return (
    <>
      <ChatHydration />
      {/* Clips vertically only: the message scroller extends sideways under the
          floating Overview card (see ConversationWorkspace). */}
      <Flexbox
        height={'100%'}
        style={{ minHeight: 0, overflowX: 'visible', overflowY: 'clip', position: 'relative' }}
        width={'100%'}
      >
        <Conversation />
      </Flexbox>
      <TelemetryNotification mobile={false} />
    </>
  );
};

export default ChatPage;
