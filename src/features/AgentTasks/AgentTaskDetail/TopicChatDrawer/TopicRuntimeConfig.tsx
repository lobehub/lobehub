import { resolveHeterogeneousRuntimeConfig } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { resolveTopicHeteroPin, topicSelectors } from '@/store/chat/slices/topic/selectors';

import { HeterogeneousTaskConfig } from '../HeterogeneousTaskConfig';

/** The explicit owner and Topic of a Task run drawer. */
interface TopicRuntimeConfigProps {
  /** The run's actual assignee, including descendant Task runs. */
  agentId: string;
  /** A run change that requests fresh Topic details; follow-ups may write a newer receipt. */
  operationId?: string | null;
  /** The run being inspected; unrelated active chat state is never consulted. */
  topicId: string;
}

/**
 * Shows the selected Task Topic's runtime configuration after its snapshot loads.
 *
 * Use when:
 * - Inspecting a run in a Task drawer or embedded run conversation.
 *
 * Expects:
 * - The explicit Topic ID; the by-id hook hydrates cold Task drawer caches.
 *
 * Returns:
 * - The Topic-scoped inspector, or nothing while its data is unavailable.
 */
export const TopicRuntimeConfig = ({ agentId, operationId, topicId }: TopicRuntimeConfigProps) => {
  const useFetchTopicDetail = useChatStore((s) => s.useFetchTopicDetail);
  useFetchTopicDetail(topicId);

  const provider = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider,
    isEqual,
  );
  // The run inspector fetches current details; a list row may predate its receipt.
  const topic = useChatStore(
    (s) => s.topicDetailMap[topicId] ?? topicSelectors.getTopicById(topicId)(s),
    isEqual,
  );
  const receipt = topic?.metadata?.heteroRuntimeConfig;
  const refreshTopicDetail = useChatStore((s) => s.refreshTopicDetail);
  useEffect(() => {
    if (!operationId) return;
    void refreshTopicDetail(topicId).catch((error) => {
      console.error('Failed to refresh Task run configuration', error);
    });
  }, [operationId, refreshTopicDetail, topicId]);

  // Task continuations change activity IDs; ordinary follow-ups can write a newer
  // Topic receipt without changing that association. Always display the latest detail.
  const pin = resolveTopicHeteroPin(topic);
  if (receipt) {
    return <HeterogeneousTaskConfig fields={receipt.fields} source={'run'} />;
  }
  if (!provider || !topic) return null;

  return (
    <HeterogeneousTaskConfig
      fields={resolveHeterogeneousRuntimeConfig(provider, pin, 'topic')}
      source={'topic'}
    />
  );
};
