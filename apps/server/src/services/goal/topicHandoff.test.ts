// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import {
  agents,
  goalEdges,
  goalEvents,
  goalNodes,
  goals,
  tasks,
  topics,
  users,
} from '@/database/schemas';
import { topicRouter } from '@/server/routers/lambda/topic';

import type * as AssignmentModule from './assignment';
import { GoalService } from './index';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => db }));
vi.mock('@/libs/oidc-provider/access-control', () => ({ assertOIDCUserActive: async () => {} }));
// Fails the Nth `setAgent` call when set; `setAgent` is an instance field, so
// it is wrapped per instance rather than spied on the prototype.
const handoff = vi.hoisted(() => ({ calls: 0, failOnCall: 0 }));
vi.mock('./assignment', async (importOriginal) => {
  const actual = await importOriginal<typeof AssignmentModule>();
  class GoalAssignmentService extends actual.GoalAssignmentService {
    constructor(...args: ConstructorParameters<typeof actual.GoalAssignmentService>) {
      super(...args);
      const setAgent = this.setAgent;
      this.setAgent = async (...setAgentArgs) => {
        handoff.calls += 1;
        if (handoff.calls === handoff.failOnCall) throw new Error('Goal not found');
        return setAgent(...setAgentArgs);
      };
    }
  }
  return { ...actual, GoalAssignmentService };
});
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));

const db = await getTestDB();
const userId = 'goal-topic-handoff-user';
const sourceAgentId = 'goal-topic-handoff-source';
const targetAgentId = 'goal-topic-handoff-target';
const topicId = 'tpc_goal_topic_handoff';

const caller = () => topicRouter.createCaller({ userId } as any);
const goalModel = () => new GoalModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId }).onConflictDoNothing();
  await db.insert(agents).values([
    { id: sourceAgentId, userId },
    { id: targetAgentId, userId },
  ]);
  await db.insert(topics).values({ agentId: sourceAgentId, id: topicId, userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  handoff.calls = 0;
  handoff.failOnCall = 0;
  for (const table of [goalEdges, goalEvents, goalNodes, goals, topics, tasks, agents, users])
    await db.delete(table);
});

/** A goal supervised from `topicId` by the source agent, with one Task still to do. */
async function goalBoundToTopic() {
  const graph = await new GoalService(db, userId).create({
    agentId: sourceAgentId,
    tasks: ['Verify on device'],
    title: 'Goal run from a conversation',
  });
  const taskNode = graph.nodes.find((node) => node.kind === 'task')!;
  const task = await new TaskModel(db, userId).create({
    assigneeAgentId: sourceAgentId,
    instruction: 'Verify on device',
    status: 'paused',
  });
  await db.update(goalNodes).set({ taskId: task.id }).where(eq(goalNodes.id, taskNode.id));
  await db
    .update(goals)
    .set({
      config: { manager: {}, managerState: { consumed: true, topicId, turns: 4 } } as any,
      status: 'running',
      subjectId: topicId,
      subjectType: 'topic',
    })
    .where(eq(goals.id, graph.goal.id));
  return { id: graph.goal.id, taskId: task.id };
}

describe('topic.batchMoveTopics with a goal bound to the topic', () => {
  it('hands the goal and its unfinished Tasks to the target agent', async () => {
    const { id, taskId } = await goalBoundToTopic();

    const result = await caller().batchMoveTopics({ targetAgentId, topicIds: [topicId] });

    expect(result).toEqual({ movedGoalIds: [id] });
    const goal = (await goalModel().findById(id))!;
    expect(goal).toMatchObject({ agentId: targetAgentId, subjectId: topicId });
    // The moved conversation is the target's now, so planning keeps landing there.
    expect(goal.config?.managerState?.topicId).toBe(topicId);
    expect((await new TaskModel(db, userId).findById(taskId))!.assigneeAgentId).toBe(targetAgentId);
  });

  it('leaves finished goals with the agent that ran them', async () => {
    const { id } = await goalBoundToTopic();
    await db.update(goals).set({ status: 'achieved' }).where(eq(goals.id, id));

    const result = await caller().batchMoveTopics({ targetAgentId, topicIds: [topicId] });

    expect(result).toEqual({ movedGoalIds: [] });
    expect((await goalModel().findById(id))!.agentId).toBe(sourceAgentId);
  });

  it('rolls the move back when a handoff fails, so no topic leaves its goal behind', async () => {
    const first = await goalBoundToTopic();
    const second = await goalBoundToTopic();
    handoff.failOnCall = 2;

    await expect(
      caller().batchMoveTopics({ targetAgentId, topicIds: [topicId] }),
    ).rejects.toThrow();

    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    expect(topic.agentId).toBe(sourceAgentId);
    // The handoff that succeeded before the failure is undone with the move.
    for (const { id, taskId } of [first, second]) {
      expect((await goalModel().findById(id))!.agentId).toBe(sourceAgentId);
      expect((await new TaskModel(db, userId).findById(taskId))!.assigneeAgentId).toBe(
        sourceAgentId,
      );
    }
  });
});
