import { Accordion, Flexbox } from '@lobehub/ui';
import React, { memo } from 'react';

import Members from './Members';
import Topic from './Topic';

export enum ChatSidebarKey {
  Members = 'members',
  Topic = 'topic',
}

const Body = memo(() => {
  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[ChatSidebarKey.Members, ChatSidebarKey.Topic]} gap={8}>
        <Members itemKey={ChatSidebarKey.Members} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
