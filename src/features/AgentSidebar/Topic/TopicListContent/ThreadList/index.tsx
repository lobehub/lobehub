import { ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import { useFetchThreads } from '@/hooks/useFetchThreads';
import { useScrollActiveThreadIntoView } from '@/hooks/useScrollActiveThreadIntoView';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

import { isSubagentThread } from './subagent';
import ThreadItem from './ThreadItem';

// Cap the thread list so a topic with many threads doesn't push the rest of the
// list off-screen; the overflow scrolls within the list itself.
// ~9 rows (NavItem 36px + 1px gap).
const MAX_HEIGHT = 9 * 37;

/**
 * Rows-only thread list, shared by its two hosts: the right working panel wraps
 * it in `ThreadListSection` (section heading + rows), while the mobile topic
 * list nests the rows under the topic row.
 */
const ThreadList = memo(({ topicId }: { topicId: string }) => {
  const threads = useChatStore(threadSelectors.getThreadsByTopic(topicId));
  // Rows open their thread in the Portal rather than switching the
  // conversation, so the row to keep in view is the Portal's current thread.
  const portalThreadId = useChatStore((s) => portalThreadSelectors.portalThreadId(s));

  useFetchThreads(topicId);

  const containerRef = useScrollActiveThreadIntoView(portalThreadId, threads?.length);

  if (!threads || threads.length === 0) return;

  return (
    <ScrollShadow
      gap={1}
      paddingBlock={1}
      ref={containerRef}
      size={12}
      style={{ maxHeight: MAX_HEIGHT }}
    >
      {threads.map((item, index) => (
        <ThreadItem
          id={item.id}
          index={index}
          isSubagent={isSubagentThread(item)}
          key={item.id}
          sourceMessageId={item.sourceMessageId ?? undefined}
          title={item.title}
        />
      ))}
    </ScrollShadow>
  );
});

ThreadList.displayName = 'ThreadList';

export default ThreadList;
