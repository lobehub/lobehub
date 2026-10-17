// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { TaskModel } from '@/database/models/task';
import { agents, goals, tasks, users, workspaceMembers, workspaces } from '@/database/schemas';

import { GoalAssignmentService } from './assignment';
import { GoalService } from './index';
import * as scheduler from './scheduler';

const db = await getTestDB();
const authorId = `goal-policy-author-${randomUUID()}`;
const memberId = `goal-policy-member-${randomUUID()}`;
const fixedAgentId = `goal-policy-fixed-${randomUUID()}`;
const openAgentId = `goal-policy-open-${randomUUID()}`;
const gemini = { model: 'gemini-3.8-flash', provider: 'google' };
let workspaceId: string;

/** A goal owned by `userId` whose main agent is `agentId`. */
const goalFor = async (userId: string, agentId: string) => {
  const graph = await new GoalService(db, userId, workspaceId).create({ agentId, title: 'Policy' });
  return graph.goal.id;
};

beforeEach(async () => {
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  await db.insert(users).values([{ id: authorId }, { id: memberId }]);
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'ws', primaryOwnerId: authorId, slug: `ws-${randomUUID()}` })
    .returning();
  workspaceId = workspace.id;
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: authorId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
  ]);
  await db.insert(agents).values([
    {
      agencyConfig: { modelSelectionPolicy: 'fixed' },
      id: fixedAgentId,
      model: 'gpt-4o-mini',
      provider: 'openai',
      slug: `fixed-${randomUUID()}`,
      userId: authorId,
      visibility: 'public',
      workspaceId,
    },
    {
      agencyConfig: { modelSelectionPolicy: 'member' },
      id: openAgentId,
      model: 'gpt-4o-mini',
      provider: 'openai',
      slug: `open-${randomUUID()}`,
      userId: authorId,
      visibility: 'public',
      workspaceId,
    },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(tasks).where(eq(tasks.workspaceId, workspaceId));
  await db.delete(goals).where(eq(goals.workspaceId, workspaceId));
  await db.delete(agents).where(eq(agents.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, authorId));
  await db.delete(users).where(eq(users.id, memberId));
});

describe('goal model overrides on a fixed-model Agent', () => {
  it("refuses a member's planning or Task model, but lets them clear it", async () => {
    const goalId = await goalFor(memberId, fixedAgentId);
    const member = new GoalAssignmentService(db, memberId, workspaceId);

    await expect(member.setModel(goalId, gemini)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(member.setTaskModel(goalId, gemini)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(member.setModel(goalId, null)).resolves.toBeTruthy();
  });

  it('lets the Agent author override it', async () => {
    const goalId = await goalFor(authorId, fixedAgentId);

    const goal = await new GoalAssignmentService(db, authorId, workspaceId).setModel(
      goalId,
      gemini,
    );

    expect(goal.config).toMatchObject({ model: 'gemini-3.8-flash' });
  });

  it('lets a member override an Agent in member-selection mode', async () => {
    const goalId = await goalFor(memberId, openAgentId);

    const goal = await new GoalAssignmentService(db, memberId, workspaceId).setModel(
      goalId,
      gemini,
    );

    expect(goal.config).toMatchObject({ model: 'gemini-3.8-flash' });
  });

  it("switches the owner's private Tasks when a Workspace admin sets the Task model", async () => {
    const privateAgentId = `goal-policy-private-${randomUUID()}`;
    await db.insert(agents).values({
      id: privateAgentId,
      model: 'gpt-4o-mini',
      provider: 'openai',
      slug: `private-${randomUUID()}`,
      userId: memberId,
      visibility: 'private',
      workspaceId,
    });
    const memberGoals = new GoalService(db, memberId, workspaceId);
    const graph = await memberGoals.create({
      agentId: privateAgentId,
      tasks: ['Only task'],
      title: 'Private work',
    });
    const { taskId } = await memberGoals.tick(graph.goal.id);
    const ownTask = () => new TaskModel(db, memberId, workspaceId).findById(taskId!);
    expect((await ownTask())?.visibility).toBe('private');

    // The Workspace owner acts on the member's goal; the Task is still the member's.
    await new GoalAssignmentService(db, authorId, workspaceId).setTaskModel(graph.goal.id, gemini);

    expect((await ownTask())?.config).toMatchObject({ model: 'gemini-3.8-flash' });
  });
});
