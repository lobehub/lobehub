import type { GoalObjective, GoalSwarmLane } from '@lobechat/types';
import { MAX_SWARM_LANES, swarmLaneKeys } from '@lobechat/utils/goalSwarm';
import { TRPCError } from '@trpc/server';

import { GoalGraphModel } from '@/database/models/goalGraph';
import { GoalRepository } from '@/database/repositories/goal';
import type { LobeChatDatabase } from '@/database/type';

import { GoalService } from './GoalService';
import { scheduleGoalAdvance } from './scheduler';
import { GoalStartService } from './start';

/**
 * Attempts a lane may use. A lane run that ends early is started again until
 * the deadline, and each start is a Task run, so the ordinary recovery budget
 * (8) would close a lane within its first hour.
 */
export const SWARM_LANE_ATTEMPTS = 1000;

export interface CreateSwarmGoalInput {
  /** The goal agent; also runs the lanes unless `taskAgentId` is set. */
  agentId?: string;
  /** ISO instant the lanes stop at. */
  deadline: string;
  lanes: number;
  objective: GoalObjective;
  requirement?: string;
  taskAgentId?: string;
  title: string;
  /** Absolute path of the workspace on the device the lanes run on. */
  workspace: string;
}

const refuse = (message: string): never => {
  throw new TRPCError({ code: 'BAD_REQUEST', message });
};

const isAbsolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);

/**
 * Create and start a swarm goal: one experiment container per lane, each
 * holding the lane's timeboxed Task; the objective, the deadline, enough
 * concurrency for every lane, and a wake at the deadline so wrap-up does not
 * wait for the next sweep.
 */
export class GoalSwarmService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  create = async (input: CreateSwarmGoalInput) => {
    const workspace = input.workspace.trim().replace(/[/\\]+$/, '');
    if (!isAbsolute(workspace)) refuse('The workspace must be an absolute path on the device');
    if (!Number.isInteger(input.lanes) || input.lanes < 1 || input.lanes > MAX_SWARM_LANES)
      refuse(`A swarm runs 1–${MAX_SWARM_LANES} lanes`);
    const deadline = Date.parse(input.deadline);
    if (!Number.isFinite(deadline) || deadline <= Date.now())
      refuse('The deadline must be in the future');
    if (!input.objective.evaluator.trim()) refuse('The objective needs an evaluator command');

    const goals = new GoalService(this.db, this.userId, this.workspaceId);
    const graph = await goals.create({
      agentId: input.agentId,
      config: {
        maxConcurrentTasks: input.lanes,
        objective: { ...input.objective, evaluator: input.objective.evaluator.trim() },
        recovery: { maxAttemptsPerTask: SWARM_LANE_ATTEMPTS },
        schedule: { deadline: new Date(deadline).toISOString() },
        ...(input.taskAgentId ? { taskAgentId: input.taskAgentId } : {}),
      },
      draft: true,
      requirement: input.requirement,
      title: input.title,
    });
    const goalId = graph.goal.id;
    const problem = graph.nodes.find((node) => node.kind === 'problem');
    if (!problem) throw new Error('Swarm goal has no problem node');

    const writer = new GoalGraphModel(this.db, this.userId, this.workspaceId);
    const lanes: GoalSwarmLane[] = [];
    for (const key of swarmLaneKeys(input.lanes)) {
      const container = await writer.createNode(goalId, {
        description: `Lane ${key}: an independent attempt at the objective in its own copy of the workspace.`,
        kind: 'experiment',
        questionId: problem.id,
        title: `Lane ${key}`,
      });
      const task = await writer.createNode(goalId, {
        description: `Improve the objective in lane ${key} until the deadline.`,
        kind: 'task',
        scopeId: container!.id,
        title: `Lane ${key}: improve ${input.objective.title || 'the objective'}`,
      });
      lanes.push({ containerId: container!.id, key, taskNodeId: task!.id });
    }

    await this.db.transaction(async (tx) => {
      const model = new GoalRepository(tx, this.userId, this.workspaceId);
      const goal = await model.lockById(goalId);
      await model.update(goalId, { config: { ...goal!.config, swarm: { lanes, workspace } } });
    });
    await new GoalStartService(this.db, this.userId, this.workspaceId).start(goalId);
    await scheduleGoalAdvance({
      goalId,
      trigger: 'start',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    // The deadline wake; a deadline past the queue's longest delay is caught
    // by the sweep and re-armed by any advance in between.
    await scheduleGoalAdvance({
      delay: Math.min(86_400, Math.ceil((deadline - Date.now()) / 1000) + 5),
      goalId,
      trigger: 'budget',
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    return goals.graph(goalId);
  };
}
