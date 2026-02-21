import { chainSummaryHistory } from '@lobechat/prompts';
import { type UIChatMessage } from '@lobechat/types';
import { TraceNameMap } from '@lobechat/types';

import { chatService } from '@/services/chat';
import { topicService } from '@/services/topic';
import { type ChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

type Setter = StoreSetter<ChatStore>;
export const chatMemory = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatMemoryActionImpl(set, get, _api);

export class ChatMemoryActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_summaryHistory = async (messages: UIChatMessage[]): Promise<void> => {
    const topicId = this.#get().activeTopicId;
    if (messages.length <= 1 || !topicId) return;

    const { model, provider } = systemAgentSelectors.historyCompress(useUserStore.getState());

    let historySummary = '';
    await chatService.fetchPresetTaskResult({
      onFinish: async (text) => {
        historySummary = text;
      },
      params: { ...chainSummaryHistory(messages), model, provider, stream: false },
      trace: {
        sessionId: this.#get().activeAgentId,
        topicId: this.#get().activeTopicId,
        traceName: TraceNameMap.SummaryHistoryMessages,
      },
    });

    await topicService.updateTopic(topicId, {
      historySummary,
      metadata: { model, provider },
    });
    await this.#get().refreshTopic();
    await this.#get().refreshMessages();
  };
}

export type ChatMemoryAction = Pick<ChatMemoryActionImpl, keyof ChatMemoryActionImpl>;
