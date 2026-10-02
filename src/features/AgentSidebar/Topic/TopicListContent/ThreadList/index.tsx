import { ThreadType } from '@lobechat/types';
import { Flexbox, ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sectionStyles } from '@/features/Conversation/WorkingSidebar/Overview/sectionStyles';
import { useFetchThreads } from '@/hooks/useFetchThreads';
import { useScrollActiveThreadIntoView } from '@/hooks/useScrollActiveThreadIntoView';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

import ThreadItem from './ThreadItem';

// Cap the nested thread list so a topic with many threads doesn't push the rest
// of the topic list off-screen; the overflow scrolls within the list itself.
// ~9 rows (NavItem 36px + 1px gap).
const MAX_HEIGHT = 9 * 37;

const ThreadList = memo(({ topicId }: { topicId: string }) => {
  const { t } = useTranslation('chat');
  const threads = useChatStore(threadSelectors.getThreadsByTopic(topicId));
  // Rows open their thread in the Portal rather than switching the
  // conversation, so the row to keep in view is the Portal's current thread.
  const portalThreadId = useChatStore((s) => portalThreadSelectors.portalThreadId(s));

  useFetchThreads(topicId);

  const containerRef = useScrollActiveThreadIntoView(portalThreadId, threads?.length);

  if (!threads || threads.length === 0) return;

  return (
    <Flexbox className={sectionStyles.section}>
      <Flexbox className={sectionStyles.sectionHeader}>
        <span className={sectionStyles.sectionTitle}>{t('workingPanel.overview.subagents')}</span>
      </Flexbox>
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
            isSubagent={item.type === ThreadType.Isolation}
            key={item.id}
            sourceMessageId={item.sourceMessageId ?? undefined}
            title={item.title}
          />
        ))}
      </ScrollShadow>
    </Flexbox>
  );
});

ThreadList.displayName = 'ThreadList';

export default ThreadList;
