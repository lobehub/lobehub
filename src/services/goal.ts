import type { GoalStatus } from '@lobechat/const/goal';
import type { GoalConfig, GoalGraphSnapshot, GoalNodeKind, GoalTickResult } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface GoalListParams {
  agentId?: string;
  limit?: number;
  offset?: number;
  projectId?: string;
  statuses?: GoalStatus[];
}

/** Every graph method takes the `goals` row id. */
class GoalService {
  /**
   * List goals. Each item is the execution-carrier task with the goal row
   * attached plus subtree run statistics — see `GoalModel.list` on the server.
   */
  list = async (params: GoalListParams) => lambdaClient.goal.list.query(params);

  /** Create a goal and seed its graph with a problem node and the given Work. */
  create = async (params: {
    agentId?: string;
    config?: GoalConfig;
    /** Set by the `/goal` tool so the seeded graph is authored by the agent. */
    createdByAgentId?: string;
    maxRounds?: number;
    maxTotalCost?: number;
    /** The user's ask in their own words — shown on the seeded problem node. */
    problemDescription?: string;
    projectId?: string;
    requirement?: string;
    title: string;
    work?: Array<{ description?: string; title: string } | string>;
  }): Promise<GoalGraphSnapshot> => {
    const { data } = await lambdaClient.goal.create.mutate(params);
    return data;
  };

  /** Delete a goal and its graph. The dispatched Work Tasks are left in place. */
  delete = async (id: string) => lambdaClient.goal.delete.mutate({ id });

  /** The whole Goal Graph in one read: nodes, edges, decisions, events, work-version links. */
  getGraph = async (id: string): Promise<GoalGraphSnapshot> => {
    const { data } = await lambdaClient.goal.graph.query({ id });
    return data;
  };

  /**
   * Run the coordinator now and report where it stopped. The goal also advances
   * on its own as its Work Tasks settle — this is the explicit nudge, not the
   * engine, so the surface never has to hold a tick loop open.
   */
  advance = async (id: string): Promise<GoalTickResult & { ticks: number }> => {
    const { data } = await lambdaClient.goal.advance.mutate({ id });
    return data;
  };

  /** Advance the graph by exactly one coordinator step. */
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
    deadline?: string | null;
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

  updateRequirement = async (id: string, requirement: string) =>
    lambdaClient.goal.updateRequirement.mutate({ id, requirement });
}

export const goalService = new GoalService();

export type GoalListResult = Awaited<ReturnType<GoalService['list']>>;
export type GoalListItem = GoalListResult['goals'][number];
