import type {
  CreateSubagentParams,
  SubagentItem,
  SubagentThreadStat,
  UpdateSubagentParams,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import type { ThreadItem } from '@/types/topic';

export class SubagentService {
  getSubagents = (parentAgentId: string): Promise<SubagentItem[]> =>
    lambdaClient.subagent.getSubagents.query({ parentAgentId });

  getSubagent = (id: string): Promise<SubagentItem | null> =>
    lambdaClient.subagent.getSubagent.query({ id });

  getSubagentThreads = (
    subagentId: string,
    page?: { limit?: number; offset?: number },
  ): Promise<ThreadItem[]> =>
    lambdaClient.subagent.getSubagentThreads.query({ subagentId, ...page }) as Promise<
      ThreadItem[]
    >;

  getSubagentStats = (parentAgentId: string): Promise<SubagentThreadStat[]> =>
    lambdaClient.subagent.getSubagentStats.query({ parentAgentId });

  createSubagent = (params: CreateSubagentParams): Promise<SubagentItem> =>
    lambdaClient.subagent.createSubagent.mutate(params);

  updateSubagent = (id: string, value: UpdateSubagentParams) =>
    lambdaClient.subagent.updateSubagent.mutate({ id, value });

  removeSubagent = (id: string) => lambdaClient.subagent.removeSubagent.mutate({ id });
}

export const subagentService = new SubagentService();
