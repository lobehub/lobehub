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

/**
 * Whether a dispatch must not start this lane after all. An advance can pick a
 * backlog lane before the deadline and only reach its claim after another
 * advance wrapped the swarm up: the deadline is gone, the lane node is
 * resolved, and the lane's Task is still in the backlog, so the ordinary
 * dispatch would pay for another lane run that nothing will ever cancel. The
 * promotion Task is not a lane, so it stays dispatchable.
 */
export const isClosedSwarmLane = (
  graph: Pick<GoalGraphSnapshot, 'goal' | 'nodes'>,
  nodeId: string,
) => {
  const swarm = graph.goal.config?.swarm;
  if (!swarm || !swarmLaneOf(graph, nodeId)) return false;
  const node = graph.nodes.find((item) => item.id === nodeId);
  return Boolean(swarm.wrapUp) || node?.status === 'resolved' || node?.status === 'retired';
};

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

/** Stops the runs a lane Task has on record, reporting what it found and what refused. */
const stopRecordedRuns = async (
  ctx: GoalServiceContext,
  taskId: string,
): Promise<{ live: number; stuck: string[] }> => {
  const stuck: string[] = [];
  let live = 0;
  const runs = await ctx.taskTopicModel.findByTaskId(taskId).catch(() => []);
  for (const run of runs) {
    if (run.status !== 'running' || !run.topicId) continue;
    live += 1;
    const stopped = await ctx.taskService.cancelTopic(run.topicId).then(
      () => true,
      (error) => {
        console.error('[GoalService.swarm] failed to stop a lane run:', error);
        return false;
      },
    );
    if (!stopped) stuck.push(run.topicId);
  }
  return { live, stuck };
};

/**
 * Lane runs that are still going at the deadline are stopped; their work stays
 * on disk. Returns the runs that refused to stop: `cancelTopic` rejects on
 * purpose when the owning device does not confirm the interruption, and
 * committing the wrap-up anyway would resolve the lanes, so nothing would ever
 * retry them and they would keep running past the deadline.
 *
 * A dispatch can claim its Task just before the deadline and record the run only
 * after `runTask` has already handed it to a device, so at the deadline there is
 * no topic to cancel yet. That start is withdrawn instead: `runTask` re-reads the
 * Task under its row lock before recording anything and interrupts whatever it
 * started once the claim is gone, so the lane cannot execute after the wrap-up
 * resolved its node. Leaving the claim behind would also hold the slot a
 * single-lane swarm's promotion needs to start.
 *
 * A withdrawal that rejects leaves that claim in place, exactly like a run that
 * refuses to cancel: the pending start can still record a run against the Task,
 * so committing the wrap-up anyway would resolve the lane under it and nothing
 * would ever retry the interruption. It is reported as stuck for the same
 * reason, and the deadline stays on the goal so the next advance comes back.
 */
export const stopLaneRuns = async (
  ctx: GoalServiceContext,
  laneNodes: GoalGraphNode[],
): Promise<string[]> => {
  const stuck: string[] = [];
  for (const node of laneNodes) {
    if (!node.taskId) continue;
    const recorded = await stopRecordedRuns(ctx, node.taskId);
    stuck.push(...recorded.stuck);
    if (recorded.live) continue;
    let withdrawn: unknown;
    try {
      withdrawn = await ctx.taskModel.updateStatusIfCurrent(node.taskId, 'running', 'backlog', {
        error: null,
      });
    } catch (error) {
      console.error('[GoalService.swarm] failed to withdraw a pending lane start:', error);
      // The claim survived the failed withdrawal, so `runTask` may still record a
      // run for it. Retry the wrap-up instead of resolving the lane underneath it.
      stuck.push(node.taskId);
      continue;
    }
    if (!withdrawn) continue;
    // The start may have recorded its run between that read and the withdrawal:
    // stop it too, since the Task is no longer running to do it for us.
    stuck.push(...(await stopRecordedRuns(ctx, node.taskId)).stuck);
  }
  return stuck;
};

/** How long a claimed wrap-up waits for its promotion Task before it is rebuilt. */
const PROMOTE_NODE_RETRY_MS = 2 * 60_000;

/**
 * Claims the wrap-up under the goal row lock. Two advances can reach the
 * deadline together — the deadline wake and a lane-completion wake — and both
 * read `swarm.wrapUp` as absent; the loser sees the claim and leaves the
 * promotion to the advance that took it.
 */
const claimWrapUp = async (
  ctx: GoalServiceContext,
  goalId: string,
  claim: NonNullable<GoalSwarm['wrapUp']>,
): Promise<boolean> =>
  ctx.db.transaction(async (tx) => {
    const model = new GoalRepository(tx, ctx.userId, ctx.workspaceId);
    const goal = await model.lockById(goalId);
    if (!goal?.config?.swarm || goal.config.swarm.wrapUp) return false;
    await model.update(goalId, {
      config: {
        ...goal.config,
        schedule: { ...goal.config.schedule, deadline: null },
        swarm: { ...goal.config.swarm, wrapUp: claim },
      },
    });
    return true;
  });

/**
 * Why `materializePromote` came back without a node id: there is nothing to
 * promote, or the graph model refused the node and the claim should be retried.
 */
type PromoteMiss = 'nothing' | 'retry';

/** Creates the claimed wrap-up's promotion Task, at most once per claim. */
const materializePromote = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  wrapUp: NonNullable<GoalSwarm['wrapUp']>,
): Promise<PromoteMiss | string> => {
  if (wrapUp.promoteNodeId) return wrapUp.promoteNodeId;
  const swarm = graph.goal.config!.swarm!;
  const laneKey = wrapUp.championLane;
  const problem = graph.nodes.find((node) => node.kind === 'problem');
  if (!laneKey || !problem) return 'nothing';
  const promote = await ctx.coordinatorGraph.createNode(graph.goal.id, {
    description: buildPromoteInstruction(swarm, laneKey),
    kind: 'task',
    title: `Promote lane ${laneKey} (score ${wrapUp.championScore})`,
  });
  // The graph model answers `undefined` when the goal is gone or the node is
  // rejected; leave the wrap-up claimed so the next tick retries the promotion
  // instead of recording a promotion that never got a Task.
  if (!promote) return 'retry';
  await ctx.coordinatorGraph.createEdge(graph.goal.id, problem.id, promote.id, 'decomposes');
  await setSwarm(ctx, graph.goal.id, (current) => ({
    ...current,
    wrapUp: { ...current.wrapUp!, promoteNodeId: promote.id },
  }));
  return promote.id;
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
  // The deadline stays on the goal until the claim is written, so an advance
  // that cannot stop a lane here comes straight back to this branch.
  const stuck = await stopLaneRuns(ctx, laneNodes);
  if (stuck.length)
    return {
      goalId: graph.goal.id,
      message: `Swarm deadline reached; ${stuck.length} lane run(s) or start(s) still owned, retrying the wrap-up`,
      outcome: 'waiting_external',
    };
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
  const claim = {
    championLane: champion?.key,
    championScore: champion ? board!.best : undefined,
    startedAt: new Date().toISOString(),
  };
  if (!(await claimWrapUp(ctx, graph.goal.id, claim))) {
    log('swarm %s wrap-up already claimed', graph.goal.id);
    return {
      goalId: graph.goal.id,
      message: 'Swarm deadline reached; another advance is already wrapping it up',
      outcome: 'advanced',
    };
  }
  await materializePromote(ctx, graph, claim);
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
    const wrapUp = swarm.wrapUp;
    if (wrapUp.promoteNodeId) {
      const promote = graph.nodes.find((node) => node.id === wrapUp.promoteNodeId);
      if (promote && promote.status !== 'resolved') return undefined;
    } else if (wrapUp.championLane) {
      // The claim is written before its promotion Task exists, so a concurrent
      // advance finishes the job. Wait for it, then finish it here if it never
      // materialized (the advance that claimed died halfway).
      const claimedAt = Date.parse(wrapUp.startedAt);
      const fresh = Number.isFinite(claimedAt) && Date.now() - claimedAt < PROMOTE_NODE_RETRY_MS;
      // Waiting is not the same as having nothing to do: the claiming advance
      // already resolved every lane Task, so handing the tick to the ordinary
      // coordinator would find no frontier and pause the goal.
      if (fresh)
        return {
          goalId: graph.goal.id,
          message: `Swarm wrap-up claimed; waiting for its promotion Task`,
          outcome: 'waiting_external',
        };
      const created = await materializePromote(ctx, graph, wrapUp);
      if (created === 'retry')
        return {
          goalId: graph.goal.id,
          message: `Swarm wrap-up could not create its promotion Task; retrying`,
          outcome: 'waiting_external',
        };
      if (created !== 'nothing')
        return {
          goalId: graph.goal.id,
          message: `Swarm deadline reached; promoting lane ${wrapUp.championLane} (score ${wrapUp.championScore})`,
          outcome: 'advanced',
        };
    }
    const message = wrapUp.championLane
      ? `Lane ${wrapUp.championLane} promoted with score ${wrapUp.championScore}`
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
