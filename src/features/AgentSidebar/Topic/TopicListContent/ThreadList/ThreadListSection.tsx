import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  sectionProps,
  sectionStyles,
} from '@/features/Conversation/WorkingSidebar/Overview/sectionStyles';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import { getThreadListHeadingKey } from './heading';
import ThreadList from './index';

/**
 * Right working-panel presentation of a topic's thread list: a section heading
 * over the rows. The heading says "Subagents" only when every row is one.
 *
 * The mobile topic list uses `ThreadList` directly instead — it has no room for
 * a section header and nests the rows under the topic row.
 */
const ThreadListSection = memo(({ topicId }: { topicId: string }) => {
  const { t } = useTranslation('chat');
  const threads = useChatStore(threadSelectors.getThreadsByTopic(topicId));

  if (!threads || threads.length === 0) return;

  return (
    <Flexbox {...sectionProps()}>
      <Flexbox {...stylex.props(sectionStyles.sectionHeader)}>
        <span {...stylex.props(sectionStyles.sectionTitle)}>
          {t(getThreadListHeadingKey(threads))}
        </span>
      </Flexbox>
      <ThreadList topicId={topicId} />
    </Flexbox>
  );
});

ThreadListSection.displayName = 'ThreadListSection';

export default ThreadListSection;
