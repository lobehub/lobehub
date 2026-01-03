import { Accordion, Flexbox } from '@lobehub/ui';
import React, { memo } from 'react';

import Topic from './Topic';

export enum ChatSidebarKey {
  Topic = 'topic',
}

const Body = memo(() => {
  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[ChatSidebarKey.Topic]} gap={8}>
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
