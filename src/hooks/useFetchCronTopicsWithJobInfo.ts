import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client/lambda';
import { useAgentStore } from '@/store/agent';

/**
 * Fetch cron topics grouped by cronJob with job information
 */
export const useFetchCronTopicsWithJobInfo = () => {
  const agentId = useAgentStore((s) => s.activeAgentId);

  const { data, isLoading, error, mutate } = useSWR(
    ENABLE_BUSINESS_FEATURES && agentId ? ['cronTopicsWithJobInfo', agentId] : null,
    async () => {
      if (!agentId) return [];

      const [cronJobsResult, cronTopicsGroups] = await Promise.all([
        lambdaClient.agentCronJob.findByAgent.query({ agentId }),
        lambdaClient.topic.getCronTopicsGroupedByCronJob.query({ agentId }),
      ]);

      const cronJobs = cronJobsResult.success ? cronJobsResult.data : [];
      const topicsByCronId = new Map(
        cronTopicsGroups.map((group) => [group.cronJobId, group.topics]),
      );
      const cronJobIds = new Set(cronJobs.map((job) => job.id));

      const groupsWithJobs = cronJobs.map((job) => ({
        cronJob: job,
        cronJobId: job.id,
        topics: topicsByCronId.get(job.id) || [],
      }));

      const orphanGroups = cronTopicsGroups
        .filter((group) => !cronJobIds.has(group.cronJobId))
        .map((group) => ({
          cronJob: null,
          cronJobId: group.cronJobId,
          topics: group.topics,
        }));

      return [...groupsWithJobs, ...orphanGroups];
    },
    {
      revalidateOnFocus: false,
    },
  );

  return {
    cronTopicsGroupsWithJobInfo: data || [],
    error,
    isLoading,
    mutate,
  };
};
