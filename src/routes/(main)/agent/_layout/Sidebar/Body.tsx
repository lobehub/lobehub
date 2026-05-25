import { Accordion, Flexbox } from '@lobehub/ui';
import React, { memo } from 'react';

import TaskList from './Task';
import Topic from './Topic';

export enum ChatSidebarKey {
  Tasks = 'tasks',
  Topic = 'topic',
}

const Body = memo(() => {
  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[ChatSidebarKey.Topic]} gap={8}>
        <TaskList itemKey={ChatSidebarKey.Tasks} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
