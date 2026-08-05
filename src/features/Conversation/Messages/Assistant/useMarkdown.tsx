'use client';

import isEqual from 'fast-deep-equal';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { useChatMarkdown } from '../useChatMarkdown';

export const useMarkdown = (id: string, disableStreaming = false) => {
  const item = useConversationStore(dataSelectors.getDbMessageById(id), isEqual)!;
  const isGenerating = useConversationStore(messageStateSelectors.isMessageGenerating(id));

  return useChatMarkdown({
    citations: item?.search?.citations,
    enableStream: !disableStreaming,
    id,
    isGenerating,
  });
};
