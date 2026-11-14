// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { TaskModel } from '@/database/models/task';
import { agents, goals, tasks, users, workspaceMembers, workspaces } from '@/database/schemas';

import { GoalAssignmentService } from './assignment';
import { GoalService } from './index';
import * as scheduler from './scheduler';

const db = await getTestDB();
const adminId = `goal-owner-admin-${randomUUID()}`;
const creatorId = `goal-owner-creator-${randomUUID()}`;
const agentId = `goal-owner-agent-${randomUUID()}`;
const personalUserId = `goal-owner-personal-${randomUUID()}`;
const personalAgentId = `goal-owner-personal-agent-${randomUUID()}`;
let workspaceId: string;

/** A public workspace goal created by `creatorId`, ready for its first Task. */
const createGoal = async () => {
  const graph = await new GoalService(db, creatorId, workspaceId).create({
    agentId,
    tasks: ['Prepare result'],
    title: 'Owner',
  });
  return graph.goal;
};

beforeEach(async () => {
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  await db.insert(users).values([{ id: adminId }, { id: creatorId }, { id: personalUserId }]);
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'ws', primaryOwnerId: adminId, slug: `ws-${randomUUID()}` })
    .returning();
  workspaceId = workspace.id;
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: adminId, workspaceId },
    { role: 'member', userId: creatorId, workspaceId },
  ]);
  await db.insert(agents).values([
    {
      id: agentId,
      model: 'gpt-4o-mini',
      provider: 'openai',
      slug: `owner-${randomUUID()}`,
      userId: adminId,
      visibility: 'public',
      workspaceId,
    },
    {
      id: personalAgentId,
      model: 'gpt-4o-mini',
      provider: 'openai',
      slug: `personal-${randomUUID()}`,
      userId: personalUserId,
    },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(tasks).where(eq(tasks.workspaceId, workspaceId));
  await db.delete(goals).where(eq(goals.workspaceId, workspaceId));
  await db.delete(agents).where(eq(agents.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, adminId));
  await db.delete(users).where(eq(users.id, creatorId));
  await db.delete(users).where(eq(users.id, personalUserId));
});

describe('goal Task owner', () => {
  it('assigns a personal goal Task to its creator, next to the executor agent', async () => {
    const service = new GoalService(db, personalUserId);
    const graph = await service.create({
      agentId: personalAgentId,
      tasks: ['Prepare result'],
      title: 'Personal',
    });

    const { taskId } = await service.tick(graph.goal.id);

    const task = await new TaskModel(db, personalUserId).findById(taskId!);
    expect(task?.assigneeUserId).toBe(personalUserId);
    expect(task?.assigneeAgentId).toBe(personalAgentId);
  });

  it('assigns a workspace goal Task to its creator', async () => {
    const goal = await createGoal();

    const { taskId } = await new GoalService(db, creatorId, workspaceId).tick(goal.id);

    const task = await new TaskModel(db, creatorId, workspaceId).findById(taskId!);
    expect(task?.assigneeUserId).toBe(creatorId);
    expect(task?.assigneeAgentId).toBe(agentId);
  });

  it('assigns to the creator, not to an admin acting on their goal', async () => {
    const goal = await createGoal();

    const { taskId } = await new GoalService(db, adminId, workspaceId).tick(goal.id);

    const task = await new TaskModel(db, adminId, workspaceId).findById(taskId!);
    expect(task?.assigneeUserId).toBe(creatorId);
  });

  it('keeps creating Tasks after the creator left the workspace, unassigned', async () => {
    const goal = await createGoal();
    await db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, creatorId)),
      );

    const { taskId } = await new GoalService(db, creatorId, workspaceId).tick(goal.id);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId!));
    expect(task.assigneeUserId).toBeNull();
    expect(task.assigneeAgentId).toBe(agentId);
  });

  it('still creates the Task when an admin drives a goal whose executor turned private', async () => {
    const goal = await createGoal();
    await db.update(agents).set({ visibility: 'private' }).where(eq(agents.id, agentId));

    const { taskId } = await new GoalService(db, adminId, workspaceId).tick(goal.id);

    const task = await new TaskModel(db, adminId, workspaceId).findById(taskId!);
    expect(task?.visibility).toBe('private');
    expect(task?.assigneeUserId).toBeNull();
  });

  it('does not assign a private goal Task created by someone else to the goal creator', async () => {
    const goal = await createGoal();

    // A private Task can only be assigned to whoever created it.
    await expect(
      new GoalAssignmentService(db, adminId, workspaceId).resolveTaskOwner({
        ...goal,
        visibility: 'private',
      }),
    ).resolves.toBeUndefined();
    await expect(
      new GoalAssignmentService(db, creatorId, workspaceId).resolveTaskOwner({
        ...goal,
        visibility: 'private',
      }),
    ).resolves.toBe(creatorId);
  });
});
