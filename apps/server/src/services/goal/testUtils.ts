/** Shared helpers for the goal service tests: the database lifecycle, and driving a batch through its release review. */
import { afterEach, beforeEach, expect, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import {
  acceptances,
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  metricPoints,
  metrics,
  projects,
  tasks,
  taskTopics,
  topics,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { GoalService } from './index';
import { GoalManagerService } from './manager';

/** Seed the test user before each test and clear everything a goal test writes after it. */
export const registerGoalServiceTestCleanup = (serverDB: LobeChatDatabase, userId: string) => {
  beforeEach(async () => {
    await serverDB.insert(users).values({ id: userId }).onConflictDoNothing();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // PGlite does not consistently order the nested user -> goal -> graph
    // cascades, so clear graph leaves explicitly before their owned roots.
    await serverDB.delete(goalNodeDecisions);
    await serverDB.delete(goalEdges);
    await serverDB.delete(goalEvents);
    await serverDB.delete(goalNodes);
    await serverDB.delete(goals);
    await serverDB.delete(metricPoints);
    await serverDB.delete(metrics);
    await serverDB.delete(acceptances);
    await serverDB.delete(agentOperations);
    // A project holds its coordinator agent; it goes before the agents do.
    await serverDB.delete(projects);
    await serverDB.delete(taskTopics);
    await serverDB.delete(topics);
    await serverDB.delete(tasks);
    await serverDB.delete(agents);
    await serverDB.delete(users);
  });
};

/** The release a passed batch gate is held for, still waiting on the owner. */
export const pendingRelease = async (service: GoalService, goalId: string) =>
  (await service.graph(goalId)).decisions.find(
    (decision) =>
      decision.status === 'pending' && decision.options?.some((option) => option.id === 'release'),
  );

/** Approve the release a passed batch gate is held for, as the owner would, and advance. */
export const approveRelease = async (service: GoalService, goalId: string) => {
  const pending = await pendingRelease(service, goalId);
  expect(pending).toBeDefined();
  await service.answerReleaseGate(pending!.nodeId, 'release');
  return service.tick(goalId);
};

/**
 * The turn a round's settled probes were handed to, so the main Agent rewrites
 * the plan from them before the gate judges them.
 */
export const distillTurn = async (db: LobeChatDatabase, userId: string, goalId: string) => {
  const state = (await new GoalModel(db, userId).findById(goalId))!.config!.managerState!;
  expect(state.problemKind).toBe('rollout_distill');
  const op = await new AgentOperationModel(db, userId).findByTopicSourceMessage(
    state.topicId,
    `msg_goal_manager_${state.token}`,
  );
  return { op: op!, state };
};

/**
 * Hand a round's settled probes to the main Agent, answer that turn with
 * `recipe`, end it, and advance until the gate is judged.
 */
export const answerDistill = async (
  service: GoalService,
  db: LobeChatDatabase,
  userId: string,
  goalId: string,
  recipe: string,
) => {
  await service.tick(goalId);
  const { op, state } = await distillTurn(db, userId, goalId);
  await new GoalManagerService(db, userId).submit(goalId, state.token, op.id, {
    action: 'revise_plan',
    reason: 'Folded what the probes ran into into the plan',
    recipe,
  });
  await new AgentOperationModel(db, userId).recordCompletion(op.id, { status: 'done' });
  await service.tick(goalId);
  await service.tick(goalId);
  return service.tick(goalId);
};
