'use client';

import { memo, useEffect } from 'react';

import { messageStateSelectors, useConversationStore, virtuaListSelectors } from '../../store';
import BackBottom from './BackBottom';

const AutoScroll = memo(() => {
  const atBottom = useConversationStore(virtuaListSelectors.atBottom);
  const isScrolling = useConversationStore(virtuaListSelectors.isScrolling);
  const isGenerating = useConversationStore(messageStateSelectors.isAIGenerating);
  const scrollToBottom = useConversationStore((s) => s.scrollToBottom);

  useEffect(() => {
    if (atBottom && isGenerating && !isScrolling) {
      scrollToBottom(false);
    }
  }, [atBottom, isGenerating, isScrolling, scrollToBottom]);

  return <BackBottom onScrollToBottom={() => scrollToBottom(true)} visible={!atBottom} />;
});

AutoScroll.displayName = 'ConversationAutoScroll';

export default AutoScroll;
