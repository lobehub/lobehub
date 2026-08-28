import type { GoalStatus } from '@lobechat/const/goal';

import { lambdaClient } from '@/libs/trpc/client';

export interface GoalListParams {
  agentId?: string;
  limit?: number;
  offset?: number;
  projectId?: string;
  statuses?: GoalStatus[];
}

class GoalService {
  /**
   * List goals. Each item is the execution-carrier task with the goal row
   * attached plus subtree run statistics — see `GoalModel.list` on the server.
   */
  list = async (params: GoalListParams) => lambdaClient.goal.list.query(params);
}

export const goalService = new GoalService();

export type GoalListResult = Awaited<ReturnType<GoalService['list']>>;
export type GoalListItem = GoalListResult['goals'][number];
