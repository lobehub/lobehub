import { buildGoalRequirement } from '@lobechat/builtin-tool-goal';
import type { GoalConfig, GoalGraphSnapshot } from '@lobechat/types';
import { goalSeedDependencyProblem } from '@lobechat/utils/goalSeeds';
import { TRPCError } from '@trpc/server';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { ProjectModel } from '@/database/models/project';
import { TopicModel } from '@/database/models/topic';
import { assertAgentUsableBy } from '@/database/utils/agent-access';

import { VerifyPlanGeneratorService } from '../../verify/planGenerator';
import { GoalAssignmentService, staleModelSlots } from '../assignment';
import { GoalManagerService } from '../manager';
import { DEFAULT_MANAGER_MAX_TURNS } from '../recoveryPolicy';
import { seedGoalTasks } from '../seedTasks';
import { assertGoalAgentVisibilityCompat, resolveGoalVisibility } from '../visibility';
import type { CreateGoalGraphInput, GoalServiceContext } from './types';

/**
 * `/goal` in a conversation: the agent running there creates the goal and
 * supervises it from that conversation.
 *
 * Identity comes from the running operation, never from the caller: the goal
 * agent is the operation's agent, the conversation is its topic, and that very
 * run becomes the first planning turn, so the agent can plan straight away with
 * the returned token instead of waiting for a dispatched turn.
 */
export const createFromConversation = async (
  ctx: GoalServiceContext,
  operationId: string,
  input: Omit<CreateGoalGraphInput, 'agentId' | 'createdByAgentId' | 'topicId'>,
  /**
   * A local desktop run keeps its operation client-side, so no server row
   * exists for `operationId`. Its conversation env names the topic and agent
   * instead; they are accepted only when the topic is the caller's and belongs
   * to that agent. Never used for operation-token callers.
   */
  localRun?: { agentId: string; topicId: string },
): Promise<{ graph: GoalGraphSnapshot; turnToken: string }> => {
  const { agentId, topicId } = await ctx.resolveTopicRun(
    operationId,
    localRun,
    'Only a run in a topic with an agent can create a goal it supervises',
  );

  // A conversation goal opens as a draft when the caller asks for one: its
  // agent arranges the graph in this run, and the goal runs only once someone
  // starts it. Opt-in, because a CLI released before `lh goal start` existed
  // could never start the draft it created.
  const created = await ctx.create({
    ...input,
    agentId,
    config: { ...input.config, manager: input.config?.manager ?? {} },
    createdByAgentId: agentId,
    topicId,
  });
  try {
    const state = await new GoalManagerService(
      ctx.db,
      ctx.userId,
      ctx.workspaceId,
    ).adoptConversationTurn(created.goal.id, { operationId, topicId });
    return { graph: (await ctx.graphModel.getGraph(created.goal.id))!, turnToken: state.token };
  } catch (error) {
    // A goal nobody can plan is worse than no goal: the agent would report it
    // created while its supervisor never gets a turn.
    await ctx.goalModel.delete(created.goal.id).catch(() => {});
    throw error;
  }
};

/**
 * The agent and topic of the run with this id, taken from the server's
 * operation row; never from the caller while that row exists. A local desktop
 * run has no row, so its env-provided topic and agent are accepted only when
 * the topic is the caller's and belongs to that agent.
 */
export const resolveTopicRun = async (
  ctx: GoalServiceContext,
  operationId: string,
  localRun: { agentId: string; topicId: string } | undefined,
  noAgentMessage: string,
): Promise<{ agentId: string; topicId: string }> => {
  const operation = await new AgentOperationModel(
    ctx.db,
    ctx.userId,
    ctx.workspaceId,
  ).findOwnOperationById(operationId);
  if (operation) {
    if (operation.status !== 'running')
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The conversation run has already ended',
      });
    if (!operation.agentId || !operation.topicId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: noAgentMessage });
    return { agentId: operation.agentId, topicId: operation.topicId };
  }
  const topic = localRun
    ? await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).findOwnTopicById(localRun.topicId)
    : undefined;
  if (!localRun || !topic || topic.agentId !== localRun.agentId)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
  return { agentId: localRun.agentId, topicId: topic.id };
};

/**
 * Attach an existing goal to the topic of the run with this id, so it
 * is supervised from there exactly as if it had been created there with
 * `/goal`: the topic's agent becomes the goal agent, the topic
 * becomes its `topic` subject and management topic. Graph, Tasks,
 * budgets and status are kept. A change of goal agent moves unfinished Tasks
 * the way `setAgent` does (unless `goalOnly`, or the goal has a dedicated
 * executor). Returns a `turnToken` when the binding run was adopted as a
 * planning turn.
 */
export const bindTopic = async (
  ctx: GoalServiceContext,
  goalId: string,
  operationId: string,
  options?: {
    force?: boolean;
    goalOnly?: boolean;
    /** A local desktop run's topic; see `resolveTopicRun`. */
    localRun?: { agentId: string; topicId: string };
  },
) => {
  const { agentId, topicId } = await ctx.resolveTopicRun(
    operationId,
    options?.localRun,
    'Only a run in a topic with an agent can supervise a goal',
  );
  // A run row names its topic, but the topic must still be the caller's and
  // the run's agent's: the binding makes that agent plan into it.
  const topic = await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).findOwnTopicById(topicId);
  if (!topic || topic.agentId !== agentId)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
  await assertAgentUsableBy(ctx.db, agentId, {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
  // Only a change of agent can break visibility; re-binding the same agent is a no-op here.
  const current = await ctx.goalModel.findById(goalId);
  if (current && current.agentId !== agentId)
    await assertGoalAgentVisibilityCompat(ctx.db, current, [agentId]);

  // One transaction: the agent change and the Task moves it implies commit
  // together. Committed apart, a failed move left the goal already on the new
  // agent, and the retry — seeing no agent change — never moved the Tasks.
  const { bound, reassignedTaskIds } = await ctx.db.transaction(async (tx) => {
    const bound = await new GoalManagerService(tx, ctx.userId, ctx.workspaceId).bindTopic(
      goalId,
      { agentId, operationId, topicId },
      { force: options?.force },
    );
    if (bound.previousAgentId === agentId) return { bound, reassignedTaskIds: [] };
    // The previous agent's model overrides do not carry to the new one.
    const assignment = new GoalAssignmentService(tx, ctx.userId, ctx.workspaceId);
    const goal = await assignment.dropModelOverride(
      bound.goal,
      staleModelSlots(
        { agentId: bound.previousAgentId ?? null, config: bound.goal.config },
        bound.goal,
      ),
    );
    const reassignedTaskIds = await assignment.followGoalAgent(goal, agentId, options?.goalOnly);
    return { bound, reassignedTaskIds };
  });
  return {
    graph: await ctx.requireGraph(goalId),
    previousSubject: bound.previousSubject,
    reassignedTaskIds,
    topicId,
    turnToken: bound.turnToken,
  };
};

export const create = async (
  ctx: GoalServiceContext,
  input: CreateGoalGraphInput,
): Promise<GoalGraphSnapshot> => {
  if (input.agentId ?? input.createdByAgentId) {
    await assertAgentUsableBy(ctx.db, (input.agentId ?? input.createdByAgentId)!, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
  }
  if (input.projectId) {
    const project = await new ProjectModel(ctx.db, ctx.userId, ctx.workspaceId).findManageableById(
      input.projectId,
    );
    if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  }
  // Persist the structured acceptance criteria first: their ids ride on the
  // goal config so the page can edit them and the terminal acceptance Task
  // is gated on exactly these checks (not an AI re-derivation of the prose).
  // The goal's agent supervises it: it owns the goal list entry, the page and,
  // in manager mode, every planning turn. An agent creating a goal for itself
  // need not repeat its id; executors are routed separately (`taskAgentId`).
  const goalAgentId = input.agentId ?? input.createdByAgentId;
  const { manager: managerOptions, taskAgentId, ...options } = input.config ?? {};
  const managed = managerOptions !== undefined;
  let config: GoalConfig | undefined = input.config ? options : undefined;
  if (taskAgentId && taskAgentId !== goalAgentId) {
    await assertAgentUsableBy(ctx.db, taskAgentId, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    config = { ...config, taskAgentId };
  }
  if (managed) {
    if (!goalAgentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A main Agent requires the goal agent',
      });
    }
    const turns = managerOptions?.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS;
    if (!Number.isInteger(turns) || turns < 1 || turns > 100)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Main Agent requires 1–100 management turns',
      });
    // Exploration, supervision and seed tasks used to be rejected here, on the
    // premise that a main Agent owns planning outright. They are layers, not
    // rivals: the system planner leads, supervision recovers known transport
    // failures, and the main Agent is handed whatever neither can route (see
    // `gateOrTakeOver`). Ordering resolves what exclusivity used to.
    // Rebuilt from the known fields: a legacy caller may still send an
    // `agentId` inside the policy, and the planning identity is the goal's.
    config = {
      ...config,
      manager: { instruction: managerOptions?.instruction, maxTurns: managerOptions?.maxTurns },
    };
  }
  // Supervision is a creation invariant, not a creation option: every Goal
  // recovers its own dropped dispatches, so a caller may tune the incident cap
  // but never opt out. This is the single choke point — the CLI, the `/goal`
  // tool, tRPC and REST all land here — so no client can create an
  // unsupervised Goal. A legacy `enabled: false` is rejected rather than
  // silently rewritten: the caller asked for the opposite of what it would
  // get, and hiding that would make the surprise surface later, mid-run.
  const seedProblem = goalSeedDependencyProblem(input.tasks ?? []);
  if (seedProblem) throw new TRPCError({ code: 'BAD_REQUEST', message: seedProblem });
  const requestedSupervision = config?.supervision;
  if (requestedSupervision?.enabled === false)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Supervision is required for every goal and cannot be disabled',
    });
  config = {
    ...config,
    supervision: {
      enabled: true,
      ...(requestedSupervision?.maxIncidents === undefined
        ? {}
        : { maxIncidents: requestedSupervision.maxIncidents }),
    },
  };
  // A supplied requirement is the user-reviewed goal document. Criteria live
  // separately; only synthesize a document when the caller omitted one.
  const requirement =
    input.requirement ??
    (input.criteria?.length ? buildGoalRequirement(input.title, input.criteria) : undefined) ??
    (input.config?.exploration ? input.title : undefined);
  if (config?.exploration) {
    const { maxExperiments, instruction } = config.exploration;
    if (
      !Number.isInteger(maxExperiments) ||
      maxExperiments < 1 ||
      maxExperiments > 200 ||
      !instruction.trim()
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Exploration requires an instruction and 1–200 experiments',
      });
    }
    if ((input.tasks?.length ?? 0) > maxExperiments) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Initial tasks exceed the experiment limit',
      });
    }
    config = { ...config, exploration: { maxExperiments, instruction } };
  }
  // Resolved before any write: a refused visibility must not leave criteria behind.
  const visibility = await resolveGoalVisibility(
    ctx.db,
    input.visibility,
    [goalAgentId, config?.taskAgentId],
    input.projectId,
  );

  if (input.criteria?.length) {
    const criteriaIds = await new VerifyPlanGeneratorService(
      ctx.db,
      ctx.userId,
      ctx.workspaceId,
    ).createCriteriaFromDrafts(
      input.criteria.map((item) => ({
        description: item.description,
        instruction: item.instruction,
        onFail: 'manual',
        required: true,
        title: item.title,
        verifierType: 'agent',
      })),
    );
    // Merge, never replace: `acceptance` also carries the numeric clauses,
    // and rebuilding the object from `criteriaIds` alone would drop a
    // measured gate the caller asked for in the same call.
    config = { ...config, acceptance: { ...config?.acceptance, criteriaIds } };
  }

  const goal = await ctx.goalModel.create({
    agentId: goalAgentId,
    config,
    maxRounds: input.maxRounds,
    maxTotalCost: input.maxTotalCost,
    projectId: input.projectId,
    requirement,
    ...(input.draft ? { status: 'draft' as const } : {}),
    ...(input.topicId
      ? { subjectId: input.topicId, subjectType: 'topic' as const }
      : { subjectType: 'standalone' as const }),
    title: input.title,
    visibility,
  });
  // `/goal` is an agent making the call. Seeding through the user-attributed
  // model would file the whole opening graph under the goal's owner, which is
  // the same loss of authorship the coordinator split just fixed.
  const authorGraph = ctx.graphAs(input.createdByAgentId);

  try {
    const problem = await authorGraph.createNode(goal.id, {
      createdByAgentId: input.createdByAgentId,
      description: input.problemDescription ?? input.requirement,
      kind: 'problem',
      status: 'active',
      title: input.title,
    });
    if (!problem) throw new Error('Failed to seed goal problem');

    // An exploration baseline is the goal's first candidate answer, so it
    // lives inside an experiment container the explorer can branch from.
    // Caller-supplied seed tasks are ordinary work: they attach straight to
    // the problem the way a planned or manager-submitted task does.
    if (config?.exploration && !input.tasks) {
      const description = `Produce one initial baseline experiment for this Goal. ${input.problemDescription ?? requirement ?? input.title}\nExploration method: ${config.exploration.instruction}\nExecute the baseline only; later experiments are scheduled by the Goal coordinator. Include a self-contained result and evidence.`;
      const experiment = await authorGraph.createNode(goal.id, {
        kind: 'experiment',
        title: input.title,
        description,
        questionId: problem.id,
        createdByAgentId: input.createdByAgentId,
      });
      if (!experiment) throw new Error('Failed to seed experiment');
      const taskNode = await authorGraph.createNode(goal.id, {
        scopeId: experiment.id,
        createdByAgentId: input.createdByAgentId,
        description,
        kind: 'task',
        title: input.title,
      });
      if (!taskNode) throw new Error('Failed to seed goal task');
    }
    await seedGoalTasks(
      authorGraph,
      goal.id,
      problem.id,
      input.tasks ?? [],
      input.createdByAgentId,
    );
  } catch (error) {
    await ctx.goalModel.delete(goal.id).catch(() => {});
    throw error;
  }
  return (await ctx.graphModel.getGraph(goal.id))!;
};
