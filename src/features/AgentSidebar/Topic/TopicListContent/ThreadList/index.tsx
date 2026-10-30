import { ScrollShadow } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { useFetchThreads } from '@/hooks/useFetchThreads';
import { useScrollActiveThreadIntoView } from '@/hooks/useScrollActiveThreadIntoView';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

import { isSubagentThread } from './subagent';
import type { SubagentFilter } from './subagentFilter';
import { filterThreadsBySubagent } from './subagentFilter';
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
interface ThreadListProps {
  /** Show only the threads one subagent preset (or the main agent) ran. */
  filter?: SubagentFilter;
  /** Preset names by id; rows a preset ran show its name under the title. */
  subagentNames?: ReadonlyMap<string, string>;
  topicId: string;
}

const ThreadList = memo(({ filter, subagentNames, topicId }: ThreadListProps) => {
  const allThreads = useChatStore(threadSelectors.getThreadsByTopic(topicId));
  const threads = useMemo(
    () => (allThreads && filter ? filterThreadsBySubagent(allThreads, filter) : allThreads),
    [allThreads, filter],
  );
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
          subagentName={item.subagentId ? subagentNames?.get(item.subagentId) : undefined}
          title={item.title}
        />
      ))}
    </ScrollShadow>
  );
});

ThreadList.displayName = 'ThreadList';

export default ThreadList;
