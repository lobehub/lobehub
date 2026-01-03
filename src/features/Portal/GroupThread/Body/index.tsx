'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

// import ChatInput from '@/app/[variants]/(main)/chat/features/Conversation/ChatInput';
// import { useChatGroupStore } from '@/store/chatGroup';

import ThreadChatList from './ThreadChatList';

const Body = memo(() => {
  // const activeThreadAgentId = useChatGroupStore((s) => s.activeThreadAgentId);

  return (
    <Flexbox height={'100%'}>
      <Flexbox flex={1} style={{ overflow: 'hidden', position: 'relative' }}>
        <ThreadChatList />
      </Flexbox>
      {/*{activeThreadAgentId && <ChatInput targetMemberId={activeThreadAgentId} />}*/}
    </Flexbox>
  );
});

export default Body;
