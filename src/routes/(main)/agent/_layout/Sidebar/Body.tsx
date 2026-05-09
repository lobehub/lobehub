import { Accordion, Flexbox } from '@lobehub/ui';
import React, { memo } from 'react';

import CronTopicList from './Cron';
import TaskList from './Task';
import Topic from './Topic';

export enum ChatSidebarKey {
  CronTopics = 'cronTopics',
  Tasks = 'tasks',
  Topic = 'topic',
}

const Body = memo(() => {
  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[ChatSidebarKey.Topic]} gap={8}>
        <TaskList itemKey={ChatSidebarKey.Tasks} />
        <CronTopicList itemKey={ChatSidebarKey.CronTopics} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
