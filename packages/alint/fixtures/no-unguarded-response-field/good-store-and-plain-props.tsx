// Fixture: arrays from a zustand store and from a plain prop interface — not raw responses.
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

interface TopicChip {
  id: string;
  title: string;
}

interface TopicChipsProps {
  pinned: TopicChip[];
}

const TopicChips = memo<TopicChipsProps>(({ pinned }) => {
  const topics = useChatStore(topicSelectors.currentTopics);

  return (
    <>
      {pinned.map((chip) => (
        <span key={chip.id}>{chip.title}</span>
      ))}
      {topics.length > 0 && topics.map((topic) => <span key={topic.id}>{topic.title}</span>)}
    </>
  );
});

export default TopicChips;
