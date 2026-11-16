import type { GoalGraphNode, GoalGraphSnapshot, GoalSwarm, GoalTickResult } from '@lobechat/types';
import { swarmLaneDirectory } from '@lobechat/utils/goalSwarm';

import { GoalRepository } from '@/database/repositories/goal';

import { GoalObjectiveService } from '../objective';
import { claimGoalTask } from '../taskClaim';
import type { GoalServiceContext } from './types';
import { log } from './utils';

/** The swarm lane a Task node runs, if any. */
export const swarmLaneOf = (graph: Pick<GoalGraphSnapshot, 'goal'>, nodeId: string) =>
  graph.goal.config?.swarm?.lanes.find((lane) => lane.taskNodeId === nodeId);

/** Whether a node is the swarm's promotion Task. */
export const isSwarmPromoteNode = (graph: Pick<GoalGraphSnapshot, 'goal'>, nodeId: string) =>
  graph.goal.config?.swarm?.wrapUp?.promoteNodeId === nodeId;

const formatDeadline = (deadline?: string | null) =>
  deadline ? new Date(deadline).toISOString().replace('.000Z', 'Z') : 'the deadline';

/**
 * What a lane run is told: its directory, its goal, that it keeps going until
 * the deadline, and how lanes share work. Replaces the ordinary Task contract,
 * whose self-acceptance and "deliver once" wording do not fit a lane.
 */
export const buildLaneInstruction = (graph: GoalGraphSnapshot, nodeId: string) => {
  const swarm = graph.goal.config!.swarm!;
  const lane = swarmLaneOf(graph, nodeId)!;
  const deadline = graph.goal.config?.schedule?.deadline;
  return [
    `You are lane ${lane.key} of a swarm working on: ${graph.goal.title}`,
    graph.goal.requirement ? `Goal: ${graph.goal.requirement}` : undefined,
    `Your working directory is your lane's own copy of the workspace (${swarmLaneDirectory(swarm.workspace, lane.key)}). Work only there; other lanes are siblings under ${swarm.workspace}/.lanes/ — read them freely, never write to them.`,
    `Improve the objective until ${formatDeadline(deadline)}. Grade with \`lh goal evaluate\` as soon as something runs and after every improvement; the leaderboard in <goal_objective> shows every lane. When another lane is clearly ahead, \`lh goal lane adopt <its key>\` replaces your files with its version (yours is kept as a snapshot) — then push it further in a different direction than that lane.`,
    'Leave a mark (`lh goal mark add …`) for every pitfall, tool or dead end another lane could use, and confirm or refute marks you relied on.',
    'This Task has no separate acceptance: the objective is its acceptance. When you stop, the lane is started again with its files as you left them until the deadline, so end a run only at a natural checkpoint, with your best version in place.',
  ]
    .filter(Boolean)
    .join('\n\n');
};

/** The one-line note a continuing lane run starts with. */
export const laneContinuationNote = (graph: GoalGraphSnapshot, nodeId: string) => {
  const lane = swarmLaneOf(graph, nodeId);
  const deadline = graph.goal.config?.schedule?.deadline;
  if (!lane || !deadline) return undefined;
  const minutes = Math.max(0, Math.round((Date.parse(deadline) - Date.now()) / 60_000));
  return `Lane ${lane.key} continues: about ${minutes} minutes remain until ${formatDeadline(deadline)}. Start from your lane's files as they are, check the leaderboard and marks, and keep improving.`;
};

export const buildPromoteInstruction = (swarm: GoalSwarm, laneKey: string) =>
  [
    `The swarm's deadline has passed and lane ${laneKey} has the best score. Promote it into the workspace.`,
    `Run exactly: \`lh goal lane promote ${laneKey}\` in ${swarm.workspace}. It snapshots the workspace into .lanes/_before_promote and copies over it the files lane ${laneKey} was graded on when it took the lead (its current files, if it never recorded a leading score).`,
    'Do nothing else: no edits, no evaluations. Report the command output.',
  ].join('\n\n');

const setSwarm = async (
  ctx: GoalServiceContext,
  goalId: string,
  edit: (swarm: GoalSwarm) => GoalSwarm,
  extra?: { clearDeadline?: boolean },
) =>
  ctx.db.transaction(async (tx) => {
    const model = new GoalRepository(tx, ctx.userId, ctx.workspaceId);
    const goal = await model.lockById(goalId);
    if (!goal?.config?.swarm) return undefined;
    return model.update(goalId, {
      config: {
        ...goal.config,
        ...(extra?.clearDeadline ? { schedule: { ...goal.config.schedule, deadline: null } } : {}),
        swarm: edit(goal.config.swarm),
      },
    });
  });

/** Lane runs that are still going at the deadline are stopped; their work stays on disk. */
const stopLaneRuns = async (ctx: GoalServiceContext, laneNodes: GoalGraphNode[]) => {
  for (const node of laneNodes) {
    if (!node.taskId) continue;
    const runs = await ctx.taskTopicModel.findByTaskId(node.taskId).catch(() => []);
    for (const run of runs) {
      if (run.status !== 'running' || !run.topicId) continue;
      await ctx.taskService.cancelTopic(run.topicId).catch((error) => {
        console.error('[GoalService.swarm] failed to stop a lane run:', error);
      });
    }
  }
};

/**
 * The deadline: stop the lanes, pick the champion from the leaderboard, and
 * queue its promotion. The deadline itself is cleared so the promotion Task
 * may still be dispatched; the lanes are resolved, so nothing restarts them.
 */
const wrapUp = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): Promise<GoalTickResult> => {
  const swarm = graph.goal.config!.swarm!;
  const laneNodes = swarm.lanes.flatMap(
    (lane) => graph.nodes.find((node) => node.id === lane.taskNodeId) ?? [],
  );
  await stopLaneRuns(ctx, laneNodes);
  for (const node of laneNodes)
    await ctx.coordinatorGraph.updateNodeStatus(
      graph.goal.id,
      node.id,
      'resolved',
      'Swarm deadline reached',
    );

  const board = await new GoalObjectiveService(ctx.db, ctx.userId, ctx.workspaceId).leaderboard(
    graph.goal.id,
  );
  const champion = board?.leader
    ? swarm.lanes.find((lane) => lane.containerId === board.leader)
    : undefined;
  const problem = graph.nodes.find((node) => node.kind === 'problem');
  const promote =
    champion && problem
      ? await ctx.coordinatorGraph.createNode(graph.goal.id, {
          description: buildPromoteInstruction(swarm, champion.key),
          kind: 'task',
          title: `Promote lane ${champion.key} (score ${board!.best})`,
        })
      : undefined;
  if (promote && problem)
    await ctx.coordinatorGraph.createEdge(graph.goal.id, problem.id, promote.id, 'decomposes');
  await setSwarm(
    ctx,
    graph.goal.id,
    (current) => ({
      ...current,
      wrapUp: {
        championLane: champion?.key,
        championScore: champion ? board!.best : undefined,
        promoteNodeId: promote?.id,
        startedAt: new Date().toISOString(),
      },
    }),
    { clearDeadline: true },
  );
  log('swarm %s wrapped up, champion %s', graph.goal.id, champion?.key ?? 'none');
  return {
    goalId: graph.goal.id,
    message: champion
      ? `Swarm deadline reached; promoting lane ${champion.key} (score ${board!.best})`
      : 'Swarm deadline reached; no lane recorded a valid score',
    outcome: 'advanced',
  };
};

/**
 * The swarm's own moves, ahead of the ordinary coordinator:
 * - before the deadline, a lane whose run finished goes straight back to the
 *   backlog, so the ordinary dispatch starts it again (no verification, and the
 *   goal's attempt budget is sized for this);
 * - at the deadline, `wrapUp`;
 * - once the promotion has run (or there was nothing to promote), the goal is
 *   achieved without a terminal acceptance Task: the objective already judged it.
 * Returns undefined to let the ordinary tick continue.
 */
export const advanceSwarm = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
): Promise<GoalTickResult | undefined> => {
  const swarm = graph.goal.config?.swarm;
  if (!swarm || graph.goal.status !== 'running') return undefined;

  if (swarm.wrapUp) {
    const promote = swarm.wrapUp.promoteNodeId
      ? graph.nodes.find((node) => node.id === swarm.wrapUp!.promoteNodeId)
      : undefined;
    if (promote && promote.status !== 'resolved') return undefined;
    const message = swarm.wrapUp.championLane
      ? `Lane ${swarm.wrapUp.championLane} promoted with score ${swarm.wrapUp.championScore}`
      : 'Swarm ended without a valid score';
    await ctx.transitionStatus(graph.goal, 'achieved', message);
    return { goalId: graph.goal.id, message, outcome: 'achieved' };
  }

  const deadline = graph.goal.config?.schedule?.deadline;
  if (deadline && Date.now() >= Date.parse(deadline)) return wrapUp(ctx, graph);

  for (const lane of swarm.lanes) {
    const node = graph.nodes.find((item) => item.id === lane.taskNodeId);
    if (!node?.taskId || node.status === 'resolved' || node.status === 'retired') continue;
    const task = await ctx.taskModel.findById(node.taskId);
    if (task?.status === 'completed') await claimGoalTask(ctx.taskModel, task, 'backlog');
  }
  return undefined;
};
