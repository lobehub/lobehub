import type { GoalAdvanceEffect } from '@lobechat/agent-tracing';
import { GOAL_COORDINATOR_ACTOR_ID } from '@lobechat/const/goal';
import type {
  GoalGraphSnapshot,
  GoalTickResult,
  TaskItem,
  TaskTopicHandoff,
  WorkVersionEventItem,
} from '@lobechat/types';
import { experimentOwner } from '@lobechat/utils/goalGraph';
import debug from 'debug';

import { GoalGraphModel } from '@/database/models/goalGraph';
import { GoalRepository } from '@/database/repositories/goal';

import {
  GOAL_ACCEPTANCE_TASK_TITLE,
  type GoalMove,
  TERMINAL_NODE_STATUSES,
} from '../decideNextMove';
import { lastAnsweredGateAt } from '../machineRecovery';
import { GoalSupervisorService } from '../supervisor';
import { TaskRecoveryCoordinator } from '../taskRecoveryCoordinator';
import { readVerificationStall, REPEATED_FAILURE_LIMIT } from '../verificationStall';
import type { GoalServiceContext } from './types';

const log = debug('lobe-server:goal-completion');

/**
 * Version events read per task run when harvesting deliverables. Generous
 * because the cap applies to events rather than to Works: the newest N events
 * of a run must still contain every Work it produced, even one revised many
 * times over.
 */
const DELIVERABLE_EVENTS_PER_RUN = 200;

/**
 * Create the Goal-level acceptance Task, or read the verdict it already
 * reached. Only runs once every other Task is terminal.
 */
export const settleTerminalAcceptance = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  move: GoalMove,
  effects: GoalAdvanceEffect[],
): Promise<GoalTickResult> => {
  const goalId = graph.goal.id;

  if (move.outcome === 'achieved') {
    // Re-read the numeric clauses right before the terminal transition: bindings,
    // provenance and freshness can change between the verdict and here, and the
    // earlier verdict is not a lease.
    const measurementChanged: GoalTickResult = {
      goalId,
      message: 'Measured acceptance changed before the Goal could be achieved; re-evaluating',
      outcome: 'no_progress',
    };
    const numeric = await ctx.evaluateMetricCriteria(await ctx.requireGraph(goalId));
    if (!numeric.allMet) return measurementChanged;
    // The map must agree with the verdict: only task nodes get resolved as
    // Tasks complete, so without this the seeded problem nodes would read
    // "active / unanswered" forever on an achieved goal.
    for (const node of graph.nodes) {
      if (node.kind !== 'problem' || TERMINAL_NODE_STATUSES.has(node.status)) continue;
      await ctx.coordinatorGraph.updateNodeStatus(goalId, node.id, 'resolved', 'Goal achieved');
      effects.push({ detail: 'resolved', nodeId: node.id, type: 'node_status' });
    }
    // Ask for the sign-off before the goal turns terminal: nothing ticks an
    // achieved goal again, so a failed write after the transition would lose
    // the ask for good. Failing here leaves the goal open for the next tick,
    // and the write is idempotent per acceptance.
    await ctx.requestSignOff(graph);
    // The final verdict and the terminal write commit together: the evidence
    // locks taken by the re-read are held until `achieved` lands, so a rebind,
    // disable or newer below-target observation cannot slip in between.
    const achieved = await ctx.db.transaction(async (tx) => {
      const model = new GoalRepository(tx, ctx.userId, ctx.workspaceId);
      const current = await model.lockById(goalId);
      if (!current || current.status !== graph.goal.status) return false;
      if (!(await ctx.evaluateMetricCriteria({ ...graph, goal: current }, tx)).allMet) return false;
      await model.updateStatus(goalId, 'achieved');
      await new GoalGraphModel(tx, ctx.userId, ctx.workspaceId, {
        id: GOAL_COORDINATOR_ACTOR_ID,
        type: 'system',
      })
        .recordGoalStatus(goalId, current.status, 'achieved', 'Goal-level acceptance passed')
        .catch((error) => console.error('[GoalService] failed to record goal status:', error));
      return true;
    });
    if (!achieved) return measurementChanged;
    effects.push({ type: 'goal_status', detail: 'achieved' });
    return { goalId, message: move.message, outcome: 'achieved' };
  }

  if (move.outcome === 'no_progress') {
    return { goalId, message: move.message, nodeId: move.focusNodeId, outcome: 'no_progress' };
  }

  // The node and its links commit together. Once the node exists no later tick
  // comes back to link it, so writing them in separate transactions let an
  // interruption in between leave the acceptance detached from the work it
  // closes for good. Rolling the node back instead lets the next tick retry.
  const result = await ctx.db.transaction(async (tx) => {
    const writer = new GoalGraphModel(tx, ctx.userId, ctx.workspaceId, {
      id: GOAL_COORDINATOR_ACTOR_ID,
      type: 'system',
    });
    const created = await writer.createNodeOnce(goalId, {
      description: [
        `Complete and prove the overall Goal acceptance requirement: ${graph.goal.requirement}`,
        'Inspect and reuse existing Goal findings, artifacts, metrics, and command results as the primary evidence. Do not repeat expensive or destructive work when the existing evidence is sufficient and still auditable.',
        'Explicitly close every remaining acceptance gap instead of treating completed upstream Tasks as proof that the whole Goal is achieved. Run only the missing or stale checks needed to close those gaps.',
        'Return one auditable final delivery with evidence for every requirement. If a requirement cannot be satisfied, state the exact gap and the minimum next action; do not claim the Goal is complete.',
        graph.goal.config?.manager && graph.goal.config.managerState?.submitted?.action === 'verify'
          ? `Main Agent verification handoff (context only, not acceptance criteria):\n${graph.goal.config.managerState.submitted.reason}\nIndependently check these notes against the evidence. They do not amend the authoritative Goal requirement or establish that it passed.`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n\n'),
      kind: 'task',
      priority: -1,
      title: GOAL_ACCEPTANCE_TASK_TITLE,
    });
    if (!created?.created) return created;

    const problem = graph.nodes.find((node) => node.kind === 'problem');
    if (problem) {
      await writer.createEdge(goalId, problem.id, created.node.id, 'decomposes');
    }
    // Acceptance closes the whole Goal, so it builds on the work that ends each
    // line of the graph. Linking the delivered leaf Tasks lays it out below them
    // instead of beside the first round. They are all resolved, so nothing blocks.
    // An experiment's Tasks are a candidate answer and stay inside it; a
    // batch's units ARE the delivered work, so they count as leaves too —
    // otherwise the report, which walks back from acceptance, never sees them.
    const ownerKind = (nodeId: string) => {
      const owner = experimentOwner(graph, nodeId);
      return owner ? graph.nodes.find((node) => node.id === owner)?.kind : undefined;
    };
    const delivered = graph.nodes.filter((node) => {
      if (node.kind !== 'task' || node.status !== 'resolved' || node.id === created.node.id)
        return false;
      const kind = ownerKind(node.id);
      return !kind || kind === 'batch';
    });
    const deliveredIds = new Set(delivered.map((node) => node.id));
    const builtUpon = new Set(
      graph.edges
        .filter((edge) => edge.kind === 'depends_on' && deliveredIds.has(edge.sourceNodeId))
        .map((edge) => edge.targetNodeId),
    );
    for (const leaf of delivered.filter((node) => !builtUpon.has(node.id))) {
      await writer.createEdge(goalId, created.node.id, leaf.id, 'depends_on');
    }
    return created;
  });
  if (!result) {
    return {
      goalId,
      message: 'Could not create the Goal-level acceptance Task',
      outcome: 'no_progress',
    };
  }
  if (result.created) {
    effects.push({ nodeId: result.node.id, type: 'created_node', detail: 'terminal acceptance' });
  }
  return {
    goalId,
    message: result.created
      ? 'Created Goal-level acceptance Task for the remaining contract'
      : 'Goal-level acceptance Task was created by another coordinator',
    nodeId: result.node.id,
    outcome: 'advanced',
  };
};

/**
 * Automatic recovery after a Task delivery failed verification. Spends the
 * Task's remaining attempt budget before it escalates to a person.
 */
export const recoverAfterVerification = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  effects: GoalAdvanceEffect[],
): Promise<GoalTickResult> => {
  const goalId = graph.goal.id;

  // Attempts that keep failing the same way will not stop doing so because the
  // budget allows another: ask a person now, with that as the reason, instead of
  // spending the rest of the budget. An unreadable history keeps the retry.
  const stalled = await readVerificationStall(
    ctx.db,
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    task.id,
    lastAnsweredGateAt(graph, nodeId),
  ).catch((error) => {
    log('task %s verification history unavailable: %O', task.identifier, error);
    return false;
  });
  if (stalled) {
    return escalateVerificationFailure(
      ctx,
      graph,
      nodeId,
      task,
      `Task ${task.identifier} failed verification the same way ${REPEATED_FAILURE_LIMIT} times in a row`,
      effects,
    );
  }

  const taskIds = graph.nodes.flatMap((node) => (node.taskId ? [node.taskId] : []));
  const runs = await ctx.taskTopicModel.findWithHandoffByTaskIds(taskIds, 10_000);
  const totalCost = runs.reduce((sum, run) => sum + Number(run.totalCost ?? 0), 0);
  const recovery = await new TaskRecoveryCoordinator(ctx.db, ctx.userId, ctx.workspaceId).recover({
    goal: graph.goal,
    spentCost: totalCost,
    task,
  });

  if (recovery.outcome === 'started' || recovery.outcome === 'already-running') {
    await ctx.coordinatorGraph.updateNodeStatus(
      goalId,
      nodeId,
      'active',
      'Automatically started the next Task attempt after verification feedback',
    );
    await ctx.transitionStatus(graph.goal, 'running', 'automatic recovery started a run');
    // Only when this advance is the one that spawned the run. Reporting it
    // for a retry another advance owns would put a run in this trajectory
    // that it did not start, and attribute its cost here.
    if (recovery.outcome === 'started') {
      effects.push({
        detail: 'verification retry',
        nodeId,
        operationId: recovery.operationId,
        targetId: task.id,
        type: 'started_run',
      });
    }
    return {
      goalId,
      message: `Automatically retried task ${task.identifier}`,
      nodeId,
      outcome: 'waiting_external',
      taskId: task.id,
    };
  }

  // The retry never reached a device. The Task keeps that reason, and the next
  // advance waits for the device to come back rather than asking a person.
  if (recovery.outcome === 'spawn-failed' && recovery.deviceUnavailable) {
    return {
      goalId: graph.goal.id,
      message: `Task ${task.identifier} is waiting for its device to reconnect`,
      nodeId,
      outcome: 'waiting_external',
      taskId: task.id,
    };
  }

  // The goal was paused or ended (a close fenced it) while this advance was
  // deciding: start nothing and do not reopen it.
  if (recovery.outcome === 'goal-stopped') {
    return {
      goalId: graph.goal.id,
      message: 'Goal stopped while recovery was being decided',
      nodeId,
      outcome: 'no_progress',
      taskId: task.id,
    };
  }

  // Nothing failed: somebody settled the Task while this advance was deciding.
  // Opening a gate would ask them to judge their own decision.
  if (recovery.outcome === 'settled') {
    return {
      goalId: graph.goal.id,
      message: `Task ${task.identifier} was settled while recovery was being decided`,
      nodeId,
      outcome: 'no_progress',
      taskId: task.id,
    };
  }
  const exhaustedReason =
    recovery.outcome === 'exhausted-cost'
      ? 'Goal cost budget was exhausted'
      : recovery.outcome === 'exhausted-rounds'
        ? 'Task attempt budget was exhausted'
        : `Automatic recovery could not start the next attempt${recovery.error ? `: ${recovery.error}` : ''}`;
  if (recovery.outcome === 'spawn-failed') {
    return ctx.gateOrTakeOver(graph, nodeId, task.id, exhaustedReason, effects, { machine: true });
  }
  // A spent goal budget is not the recipe's fault either: the ordinary gate.
  if (recovery.outcome === 'exhausted-cost') {
    return ctx.gateOrTakeOver(graph, nodeId, task.id, exhaustedReason, effects);
  }
  return escalateVerificationFailure(ctx, graph, nodeId, task, exhaustedReason, effects);
};

/**
 * Hand a Task that cannot pass its verification on its own to a person.
 *
 * R6: a batch member that cannot pass its own check breaks the class, like one
 * that failed outright — revise the recipe and re-probe, not a standalone
 * retry/retire gate (retiring a last-wave member would let the goal head for
 * acceptance with the unit undone).
 */
const escalateVerificationFailure = (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  task: TaskItem,
  reason: string,
  effects: GoalAdvanceEffect[],
): Promise<GoalTickResult> => {
  if (ctx.isBatchMember(graph, nodeId)) {
    const title = graph.nodes.find((node) => node.id === nodeId)?.title ?? task.identifier;
    return ctx.openPatternBreakGate(graph, `${title}: ${reason}`, effects, { unitId: nodeId });
  }
  return ctx.gateOrTakeOver(graph, nodeId, task.id, reason, effects);
};

/**
 * Link what a task actually delivered to the node that ordered it.
 *
 * The task Work attached alongside is the execution container; these are its
 * outputs — the documents and external resources the run registered. Without
 * them the graph records that a task finished but not what it produced, and
 * the deliverable survives only as a URL buried in the finding's prose.
 *
 * Harvested across every run of the task, not just the delivering one: a task
 * that wrote its document in an earlier round and only revised it in the last
 * still delivered that document. Works are deduplicated by identity and
 * linked at their newest version, so a document refined across rounds is one
 * deliverable with a history rather than several deliverables.
 *
 * Two rules keep one deliverable from being declared once per task:
 *
 * - **Created only.** A Work none of the task's runs created is someone
 *   else's artifact this task happened to revise. A shared backlog document
 *   that every run appends to is the case that surfaced this: without the
 *   rule the document is declared as the output of every task in the goal.
 * - **Claimed once per goal.** The first node to deliver a Work owns it. A
 *   later node that revises it adds no link and no lifecycle event, so the
 *   history reads "C1-c delivered the backlog" instead of repeating the same
 *   deliverable under each task.
 *
 * `task` Works are deliberately excluded: the responsible task's own Work is
 * the execution container and the caller already links it. `file` Works are
 * opt-in at the registry (conversation lists do not want every exported
 * file), but a goal's deliverables are exactly where a produced deck or PDF
 * belongs, so they are requested explicitly here.
 */
export const attachTaskDeliverables = async (
  ctx: GoalServiceContext,
  goalId: string,
  nodeId: string,
  operationIds: string[],
  effects: GoalAdvanceEffect[],
) => {
  if (operationIds.length === 0) return;

  // The per-operation cap is applied to version EVENTS before this dedupes by
  // Work identity, so the default of 20 lets a document revised twenty times
  // push every other deliverable out of its own task's list.
  const byOperation = await ctx.workModel.listByRootOperations({
    includeFileWorks: true,
    limit: DELIVERABLE_EVENTS_PER_RUN,
    rootOperationIds: operationIds,
  });

  const claimedWorkIds = await ctx.coordinatorGraph.listProducedWorkIds(goalId);

  // Per Work: whether the task's runs created it, and the newest version they
  // registered. `created` is sticky across the run's versions — a document
  // written in round one and revised in round three is still this task's
  // deliverable, while one that was only ever revised is not.
  const harvestByWork = new Map<string, { created: boolean; item: WorkVersionEventItem }>();
  for (const item of Object.values(byOperation).flat()) {
    if (item.type === 'task') continue;
    const seen = harvestByWork.get(item.id);
    const created = item.version.changeType === 'created';
    if (!seen) {
      harvestByWork.set(item.id, { created, item });
      continue;
    }
    harvestByWork.set(item.id, {
      created: seen.created || created,
      item: seen.item.version.createdAt < item.version.createdAt ? item : seen.item,
    });
  }

  for (const [workId, { created, item }] of harvestByWork) {
    if (!created || claimedWorkIds.has(workId)) continue;
    const link = await ctx.coordinatorGraph.attachWorkVersion(
      goalId,
      nodeId,
      item.version.id,
      'produced',
    );
    // `attachWorkVersion` is idempotent, so a re-settled task re-links the
    // same versions silently; only a genuinely new link is worth an effect.
    if (link)
      effects.push({
        detail: item.type,
        nodeId,
        targetId: item.id,
        type: 'attached_work_version',
      });
  }
};

export const consumeCompletedTask = async (
  ctx: GoalServiceContext,
  graph: GoalGraphSnapshot,
  nodeId: string,
  taskId: string,
  effects: GoalAdvanceEffect[] = [],
): Promise<GoalTickResult> => {
  // `graph` can predate a retirement that landed while this tick ran. A
  // retired node's late output must not enter the Goal as a finding or
  // deliverable (and `updateNodeStatus` refuses to revive the node).
  if ((await ctx.coordinatorGraph.getNodeStatus(graph.goal.id, nodeId)) === 'retired') {
    return {
      goalId: graph.goal.id,
      message: 'Node was retired; the task outcome is discarded',
      nodeId,
      outcome: 'no_progress',
      taskId,
    };
  }
  const existingFinding = graph.edges.some(
    (edge) => edge.sourceNodeId === nodeId && edge.kind === 'produces',
  );
  // The newest row by seq can be a retry that was canceled when verification
  // accepted an earlier delivery — the settle path cancels the in-flight
  // attempt it superseded. The finding must be synthesized from the run that
  // actually delivered, so prefer the newest completed topic (with a handoff
  // when one exists) over whatever happens to be last.
  const recent = await ctx.taskTopicModel.findWithHandoff(taskId, 10);
  const latest =
    recent.find((topic) => topic.status === 'completed' && topic.handoff) ??
    recent.find((topic) => topic.status === 'completed') ??
    recent[0];
  const completedWork = await ctx.workModel.registerTask({
    changeType: 'updated',
    rootOperationId: latest?.operationId,
    taskId,
    toolIdentifier: 'goal-coordinator',
    toolName: 'synthesizeTaskOutcome',
    topicId: latest?.topicId,
  });
  effects.push({
    nodeId,
    operationId: latest?.operationId ?? undefined,
    targetId: taskId,
    type: 'node_status',
    detail: 'resolved',
  });
  // The container link is written once per node — at dispatch, or by
  // `ensureTaskWorkVersion` for a node that never got one. Re-linking the
  // completed version only appended a second identical row for the same task:
  // the goal's task-container links were one per settle round instead of one
  // per node, which is where half of the graph's hidden Work links came from.
  const containerLinked = graph.workVersions.some(
    (link) =>
      link.nodeId === nodeId &&
      link.relation === 'produced' &&
      link.work?.workId === completedWork?.id,
  );
  if (completedWork?.currentVersionId && !containerLinked) {
    await ctx.coordinatorGraph.attachWorkVersion(
      graph.goal.id,
      nodeId,
      completedWork.currentVersionId,
      'produced',
    );
  }
  // Every run of the task, not the ten `findWithHandoff` reads for the
  // finding: an attempt budget above ten would otherwise strand a deliverable
  // produced early and merely referenced later.
  const allRuns = await ctx.taskTopicModel.findByTaskId(taskId);
  await ctx.attachTaskDeliverables(
    graph.goal.id,
    nodeId,
    allRuns.flatMap((topic) => (topic.operationId ? [topic.operationId] : [])),
    effects,
  );
  if (!existingFinding) {
    const handoff = latest?.handoff as TaskTopicHandoff | null;
    const title =
      handoff?.title ??
      handoff?.summary ??
      `Completed: ${graph.nodes.find((node) => node.id === nodeId)?.title}`;
    // The finding is written by whoever did the work. Recorded as the owner,
    // it read as something the person had said themselves.
    const author = (await ctx.taskModel.findById(taskId))?.assigneeAgentId ?? graph.goal.agentId;
    const finding = await ctx.coordinatorGraph.createNode(graph.goal.id, {
      confidence: 1,
      createdByAgentId: author ?? undefined,
      description: handoff?.content ?? handoff?.summary ?? undefined,
      kind: 'finding',
      scopeId: experimentOwner(graph, nodeId),
      status: 'resolved',
      title,
    });
    if (finding) {
      effects.push({ detail: 'finding', nodeId, targetId: finding.id, type: 'created_node' });
      await ctx.coordinatorGraph.createEdge(graph.goal.id, nodeId, finding.id, 'produces');
    }
  }
  await ctx.coordinatorGraph.updateNodeStatus(
    graph.goal.id,
    nodeId,
    'resolved',
    'Responsible task completed',
  );
  await new GoalSupervisorService(ctx.db, ctx.userId, ctx.workspaceId).recordProgress(
    graph,
    taskId,
    false,
    latest?.status === 'completed' ? (latest.operationId ?? undefined) : undefined,
  );
  return {
    goalId: graph.goal.id,
    message: 'Task outcome was synthesized into a finding',
    nodeId,
    outcome: 'advanced',
    taskId,
  };
};
