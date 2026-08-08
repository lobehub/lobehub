import { ThreadType } from '@lobechat/types';
import { ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import { useFetchThreads } from '@/hooks/useFetchThreads';
import { useScrollActiveThreadIntoView } from '@/hooks/useScrollActiveThreadIntoView';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import ThreadItem from './ThreadItem';

// Cap the nested thread list so a topic with many threads doesn't push the rest
// of the topic list off-screen; the overflow scrolls within the list itself.
// ~9 rows (NavItem 36px + 1px gap).
const MAX_HEIGHT = 9 * 37;

const ThreadList = memo(({ topicId }: { topicId: string }) => {
  const threads = useChatStore(threadSelectors.getThreadsByTopic(topicId));
  const activeThreadId = useChatStore((s) => s.activeThreadId);

  useFetchThreads(topicId);

  const containerRef = useScrollActiveThreadIntoView(activeThreadId, threads?.length);

  if (!threads || threads.length === 0) return;

  return (
    <ScrollShadow
      gap={1}
      paddingBlock={1}
      ref={containerRef}
      size={12}
      style={{ maxHeight: MAX_HEIGHT }}
    >
      {threads?.map((item, index) => (
        <ThreadItem
          id={item.id}
          index={index}
          isSubagent={item.type === ThreadType.Isolation}
          key={item.id}
          title={item.title}
        />
      ))}
    </ScrollShadow>
  );
});

ThreadList.displayName = 'ThreadList';

export default ThreadList;
