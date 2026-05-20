import { messageStateSelectors, useConversationStore } from '../../store';
import { useChatMarkdown } from '../useChatMarkdown';

export const useMarkdown = (id: string, disableStreaming = false) => {
  const isGenerating = useConversationStore(
    messageStateSelectors.isAssistantGroupItemGenerating(id),
  );

  return useChatMarkdown({
    enableStream: !disableStreaming,
    id,
    isGenerating,
  });
};
