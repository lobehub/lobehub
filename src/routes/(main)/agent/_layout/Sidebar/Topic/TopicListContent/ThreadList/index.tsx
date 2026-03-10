import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useFetchThreads } from '@/hooks/useFetchThreads';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import ThreadItem from './ThreadItem';

const ThreadList = memo(() => {
  const [id] = useChatStore((s) => [s.activeTopicId]);
  const threads = useChatStore(threadSelectors.getThreadsByTopic(id));

  useFetchThreads(id);

  if (!threads || threads.length === 0) return;

  return (
    <Flexbox gap={1} paddingBlock={1}>
      {threads?.map((item, index) => (
        <ThreadItem id={item.id} index={index} key={item.id} title={item.title} />
      ))}
    </Flexbox>
  );
});

ThreadList.displayName = 'ThreadList';

export default ThreadList;
