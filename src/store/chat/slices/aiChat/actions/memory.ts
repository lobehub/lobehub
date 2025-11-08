import { chainSummaryHistory } from '@lobechat/prompts';
import { TraceNameMap, UIChatMessage } from '@lobechat/types';
import { StateCreator } from 'zustand/vanilla';

import { chatService } from '@/services/chat';
import { topicService } from '@/services/topic';
import { ChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

export interface ChatMemoryAction {
  internal_summaryHistory: (messages: UIChatMessage[]) => Promise<void>;
}

export const chatMemory: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatMemoryAction
> = (set, get) => ({
  internal_summaryHistory: async (messages) => {
    const topicId = get().activeTopicId;
    if (messages.length <= 1 || !topicId) return;

    const { model, provider } = systemAgentSelectors.historyCompress(useUserStore.getState());

    let historySummary = '';
    await chatService.fetchPresetTaskResult({
      onFinish: async (text) => {
        historySummary = text;
      },
      params: { ...chainSummaryHistory(messages), model, provider, stream: false },
      trace: {
        sessionId: get().activeId,
        topicId: get().activeTopicId,
        traceName: TraceNameMap.SummaryHistoryMessages,
      },
    });

    await topicService.updateTopic(topicId, {
      historySummary,
      metadata: { model, provider },
    });
    await get().refreshTopic();
    await get().refreshMessages();
  },
});
