import type { GoalStatus } from '@lobechat/const/goal';
import type { GoalGraphSnapshot, GoalNodeKind, GoalTickResult } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface GoalListParams {
  agentId?: string;
  limit?: number;
  offset?: number;
  projectId?: string;
  statuses?: GoalStatus[];
}

/**
 * Every graph method takes the `goals` row id — not the carrier task's
 * identifier the goal detail route is keyed by. Callers resolve it from
 * `task.goal.id` first.
 */
class GoalService {
  /**
   * List goals. Each item is the execution-carrier task with the goal row
   * attached plus subtree run statistics — see `GoalModel.list` on the server.
   */
  list = async (params: GoalListParams) => lambdaClient.goal.list.query(params);

  /** The whole Goal Graph in one read: nodes, edges, decisions, events, work-version links. */
  getGraph = async (id: string): Promise<GoalGraphSnapshot> => {
    const { data } = await lambdaClient.goal.graph.query({ id });
    return data;
  };

  /**
   * Advance the graph by one coordinator step. There is no server-side driver
   * for graph goals: they only move while a client (or the CLI) keeps ticking.
   */
  tick = async (id: string): Promise<GoalTickResult> => {
    const { data } = await lambdaClient.goal.tick.mutate({ id });
    return data;
  };

  /** Stop scheduling new work. Does not abort the operation already running. */
  pause = async (id: string) => lambdaClient.goal.pause.mutate({ id });

  resume = async (id: string) => lambdaClient.goal.resume.mutate({ id });

  /** Resolve a pending decision gate. Does not resume a paused goal by itself. */
  decide = async (params: {
    decisionId: string;
    id: string;
    optionId: string;
    resolution?: string;
  }) => lambdaClient.goal.decide.mutate(params);

  setBudget = async (params: {
    id: string;
    maxRounds?: number | null;
    maxTotalCost?: number | null;
  }) => lambdaClient.goal.setBudget.mutate(params);

  addNode = async (params: {
    description?: string;
    id: string;
    kind: GoalNodeKind;
    priority?: number;
    title: string;
  }) => lambdaClient.goal.addNode.mutate(params);
}

export const goalService = new GoalService();

export type GoalListResult = Awaited<ReturnType<GoalService['list']>>;
export type GoalListItem = GoalListResult['goals'][number];
