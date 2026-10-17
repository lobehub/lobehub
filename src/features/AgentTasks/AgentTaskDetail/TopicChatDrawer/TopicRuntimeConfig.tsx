import { resolveHeterogeneousRuntimeConfig } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useEffect, useRef } from 'react';

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
  const { revalidate } = useFetchTopicDetail(topicId);

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
  // A run this client did not dispatch (a scheduled Task run, another tab) writes
  // a newer receipt under the same Topic ID. The by-id SWR entry above already
  // loads on mount; revalidate that same entry only when the run changes.
  const seenOperation = useRef({ operationId, topicId });
  useEffect(() => {
    const seen = seenOperation.current;
    if (seen.topicId !== topicId) {
      seenOperation.current = { operationId, topicId };
      return;
    }
    if (!operationId || seen.operationId === operationId) return;
    seenOperation.current = { operationId, topicId };
    void revalidate().catch((error) => {
      console.error('Failed to refresh Task run configuration', error);
    });
  }, [operationId, revalidate, topicId]);

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
