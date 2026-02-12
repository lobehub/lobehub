import { type SWRResponse } from 'swr';

import { type AgentCronJob } from '@/database/schemas/agentCronJob';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client/lambda';
import { agentCronJobService } from '@/services/agentCronJob';
import { type StoreSetter } from '@/store/types';

import { type AgentStore } from '../../store';

const FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY = 'cronTopicsWithJobInfo';

export interface CronTopicGroupWithJobInfo {
  cronJob: AgentCronJob | null;
  cronJobId: string;
  topics: Array<{
    createdAt: Date | string;
    favorite?: boolean | null;
    historySummary?: string | null;
    id: string;
    metadata?: any;
    title?: string | null;
    trigger?: string | null;
    updatedAt: Date | string;
  }>;
}

/**
 * Cron Slice Actions
 * Handles agent cron job operations
 */

type Setter = StoreSetter<AgentStore>;
export const createCronSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new CronSliceActionImpl(set, get, _api);

export class CronSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createAgentCronJob = async (): Promise<string | null> => {
    const { activeAgentId, internal_refreshCronTopics } = this.#get();
    if (!activeAgentId) return null;

    try {
      const result = await agentCronJobService.create({
        agentId: activeAgentId,
        content: '',
        cronPattern: '*/30 * * * *',
        enabled: false,
      });

      if (result.success) {
        await internal_refreshCronTopics();
        return result.data.id;
      }
      return null;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      return null;
    }
  };

  internal_refreshCronTopics = async (): Promise<void> => {
    await mutate([FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY, this.#get().activeAgentId]);
  };

  useFetchCronTopicsWithJobInfo = (
    agentId?: string,
    enabled: boolean = true,
  ): SWRResponse<CronTopicGroupWithJobInfo[]> => {
    return useClientDataSWR<CronTopicGroupWithJobInfo[]>(
      enabled && agentId ? [FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY, agentId] : null,
      async ([, id]: [string, string]) => {
        const [cronJobsResult, cronTopicsGroups] = await Promise.all([
          lambdaClient.agentCronJob.findByAgent.query({ agentId: id }),
          lambdaClient.topic.getCronTopicsGroupedByCronJob.query({ agentId: id }),
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
        fallbackData: [],
        revalidateOnFocus: false,
      },
    );
  };
}

export type CronSliceAction = Pick<CronSliceActionImpl, keyof CronSliceActionImpl>;
