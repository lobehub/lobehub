'use client';

import { Flexbox } from '@lobehub/ui';

import ThreadChatList from './ThreadChatList';

const Body = () => {
  return (
    <Flexbox height={'100%'}>
      <Flexbox flex={1} style={{ overflow: 'hidden', position: 'relative' }}>
        <ThreadChatList />
      </Flexbox>
    </Flexbox>
  );
};

export default Body;
