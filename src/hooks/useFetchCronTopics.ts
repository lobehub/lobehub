import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client/lambda';
import { useAgentStore } from '@/store/agent';

/**
 * Fetch cron topics grouped by cronJob for the current agent
 */
export const useFetchCronTopics = () => {
  const agentId = useAgentStore((s) => s.activeAgentId);

  const { data, isLoading, error, mutate } = useSWR(
    agentId ? ['cronTopics', agentId] : null,
    async () => {
      if (!agentId) return [];
      return await lambdaClient.topic.getCronTopicsGroupedByCronJob.query({ agentId });
    },
    {
      revalidateOnFocus: false,
    },
  );

  return {
    cronTopicsGroups: data || [],
    error,
    isLoading,
    mutate,
  };
};
