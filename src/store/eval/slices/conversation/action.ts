import type { ChatTopic, RecentTopic } from '@lobechat/types';
import type { SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { topicKeys } from '@/libs/swr/keys';
import { topicService } from '@/services/topic';
import type { EvalStore } from '@/store/eval/store';
import type { StoreSetter } from '@/store/types';

type Setter = StoreSetter<EvalStore>;

export interface EvalConversationTopic {
  agentTitle?: string | null;
  id: string;
  title: string | null;
  updatedAt?: Date | number | string | null;
}

const searchTopic = (topic: ChatTopic): EvalConversationTopic => ({
  id: topic.id,
  title: topic.title,
  updatedAt: topic.updatedAt,
});

const recentTopic = (topic: RecentTopic): EvalConversationTopic => ({
  agentTitle: topic.agent?.title,
  id: topic.id,
  title: topic.title,
  updatedAt: topic.updatedAt,
});

export const createConversationSlice = (set: Setter, get: () => EvalStore, api?: unknown) =>
  new ConversationActionImpl(set, get, api);

export class ConversationActionImpl {
  constructor(_set: Setter, _get: () => EvalStore, _api?: unknown) {
    void _set;
    void _get;
    void _api;
  }

  /** The picker is a transient lookup; its workspace-scoped SWR cache owns the rows. */
  useFetchConversationTopics = (query: string): SWRResponse<EvalConversationTopic[]> =>
    useClientDataSWR<EvalConversationTopic[]>(topicKeys.evalPicker(query, 30), async () => {
      if (query) return (await topicService.searchTopics(query)).map(searchTopic);

      return (await topicService.getRecentTopics(30))
        .filter((topic) => topic.type === 'agent')
        .map(recentTopic);
    });
}

export type ConversationAction = Pick<ConversationActionImpl, keyof ConversationActionImpl>;
