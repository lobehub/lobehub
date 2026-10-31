// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import {
  agentOperations,
  agents,
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goals,
  messages,
  tasks,
  taskTopics,
  topics,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import { AiAgentService } from '@/server/services/aiAgent';

import { GoalService } from './index';
import * as scheduler from './scheduler';

const db = await getTestDB();
const ownerId = `goal-vis-owner-${randomUUID()}`;
const memberId = `goal-vis-member-${randomUUID()}`;
const publicAgentId = `goal-vis-public-${randomUUID()}`;
const privateAgentId = `goal-vis-private-${randomUUID()}`;
let workspaceId: string;
let seq = 0;

const ownerGoals = () => new GoalService(db, ownerId, workspaceId);
const memberGoals = () => new GoalService(db, memberId, workspaceId);
const memberSees = async (goalId: string) =>
  !!(await new GoalModel(db, memberId, workspaceId).findById(goalId));
const taskVisibility = async (taskId: string) =>
  (await new TaskModel(db, ownerId, workspaceId).findById(taskId))?.visibility;

beforeEach(async () => {
  vi.spyOn(scheduler, 'scheduleGoalAdvance').mockResolvedValue();
  vi.spyOn(AiAgentService.prototype, 'execAgent').mockImplementation(async (params) => {
    const operationId = `op-goal-vis-${++seq}`;
    const topicId = params.appContext!.topicId!;
    await new AgentOperationModel(db, ownerId, workspaceId).recordStart({
      agentId: params.agentId,
      appContext: { sourceMessageId: params.clientIds?.userMessageId },
      operationId,
      topicId,
    });
    return {
      agentId: params.agentId!,
      assistantMessageId: 'm',
      autoStarted: true,
      createdAt: new Date().toISOString(),
      message: 'started',
      operationId,
      status: 'running',
      success: true,
      timestamp: new Date().toISOString(),
      topicId,
      userMessageId: 'u',
    };
  });
  await db.insert(users).values([{ id: ownerId }, { id: memberId }]);
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'ws', primaryOwnerId: ownerId, slug: `ws-${randomUUID()}` })
    .returning();
  workspaceId = workspace.id;
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
  ]);
  await db.insert(agents).values([
    {
      id: publicAgentId,
      model: 'gpt-4o-mini',
      provider: 'openai',
      slug: `public-${randomUUID()}`,
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
    {
      id: privateAgentId,
      model: 'gpt-4o-mini',
      provider: 'openai',
      slug: `private-${randomUUID()}`,
      userId: ownerId,
      visibility: 'private',
      workspaceId,
    },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const table of [
    goalNodeDecisions,
    goalEdges,
    goalEvents,
    goalNodes,
    goals,
    agentOperations,
    messages,
    taskTopics,
    topics,
    tasks,
    agents,
    workspaceMembers,
    workspaces,
    users,
  ])
    await db.delete(table);
});

describe('goal visibility on create', () => {
  it('follows a private agent and hides the goal from other members', async () => {
    const graph = await ownerGoals().create({ agentId: privateAgentId, title: 'Mine' });

    expect(graph.goal.visibility).toBe('private');
    expect(await memberSees(graph.goal.id)).toBe(false);
    const listed = await new GoalModel(db, memberId, workspaceId).list();
    expect(listed.goals.map((row) => row.goal.id)).not.toContain(graph.goal.id);
    const ownerList = await new GoalModel(db, ownerId, workspaceId).list();
    expect(ownerList.goals.map((row) => row.goal.id)).toContain(graph.goal.id);
  });

  it("hides a member's private goal from the workspace owner too", async () => {
    await db.insert(agents).values({
      id: `${privateAgentId}-member`,
      slug: `member-private-${randomUUID()}`,
      userId: memberId,
      visibility: 'private',
      workspaceId,
    });
    const graph = await memberGoals().create({
      agentId: `${privateAgentId}-member`,
      title: 'Member goal',
    });

    expect(await new GoalModel(db, ownerId, workspaceId).findById(graph.goal.id)).toBeUndefined();
  });

  it('is public on a public agent, and private when asked', async () => {
    const shared = await ownerGoals().create({ agentId: publicAgentId, title: 'Shared' });
    const kept = await ownerGoals().create({
      agentId: publicAgentId,
      title: 'Kept',
      visibility: 'private',
    });

    expect(shared.goal.visibility).toBe('public');
    expect(await memberSees(shared.goal.id)).toBe(true);
    expect(kept.goal.visibility).toBe('private');
    expect(await memberSees(kept.goal.id)).toBe(false);
  });

  it('refuses a public goal on a private agent or executor', async () => {
    await expect(
      ownerGoals().create({ agentId: privateAgentId, title: 'Leak', visibility: 'public' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      ownerGoals().create({
        agentId: publicAgentId,
        config: { taskAgentId: privateAgentId },
        title: 'Leak',
        visibility: 'public',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("keeps a private goal's Tasks private even on a public agent", async () => {
    const graph = await ownerGoals().create({
      agentId: publicAgentId,
      tasks: ['Only task'],
      title: 'Kept',
      visibility: 'private',
    });
    const { taskId } = await ownerGoals().tick(graph.goal.id);

    expect(await taskVisibility(taskId!)).toBe('private');
  });
});

describe('setVisibility', () => {
  it('moves the goal and its Tasks both ways', async () => {
    const graph = await ownerGoals().create({
      agentId: publicAgentId,
      tasks: ['Only task'],
      title: 'Shared',
    });
    const { taskId } = await ownerGoals().tick(graph.goal.id);
    expect(await taskVisibility(taskId!)).toBe('public');

    const hidden = await ownerGoals().setVisibility(graph.goal.id, 'private');
    expect(hidden.goal.visibility).toBe('private');
    expect(hidden.taskIds).toEqual([taskId]);
    expect(await taskVisibility(taskId!)).toBe('private');
    expect(await memberSees(graph.goal.id)).toBe(false);

    const shown = await ownerGoals().setVisibility(graph.goal.id, 'public');
    expect(shown.goal.visibility).toBe('public');
    expect(await taskVisibility(taskId!)).toBe('public');
    expect(await memberSees(graph.goal.id)).toBe(true);
  });

  it('refuses to publish a goal run by a private agent', async () => {
    const graph = await ownerGoals().create({ agentId: privateAgentId, title: 'Mine' });

    await expect(ownerGoals().setVisibility(graph.goal.id, 'public')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it("refuses a member changing another member's goal", async () => {
    const graph = await ownerGoals().create({ agentId: publicAgentId, title: 'Shared' });

    await expect(memberGoals().setVisibility(graph.goal.id, 'private')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses personal goals, where visibility does not apply', async () => {
    const personalAgentId = `goal-vis-personal-${randomUUID()}`;
    await db.insert(agents).values({ id: personalAgentId, slug: personalAgentId, userId: ownerId });
    const graph = await new GoalService(db, ownerId).create({
      agentId: personalAgentId,
      title: 'Personal',
    });

    await expect(
      new GoalService(db, ownerId).setVisibility(graph.goal.id, 'private'),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('agent handoff', () => {
  it('refuses handing a public goal to a private agent', async () => {
    const graph = await ownerGoals().create({ agentId: publicAgentId, title: 'Shared' });

    await expect(ownerGoals().setAgent(graph.goal.id, privateAgentId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(ownerGoals().setTaskAgent(graph.goal.id, privateAgentId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('lets a private goal move to a private agent', async () => {
    const graph = await ownerGoals().create({
      agentId: publicAgentId,
      title: 'Kept',
      visibility: 'private',
    });

    await expect(ownerGoals().setAgent(graph.goal.id, privateAgentId)).resolves.toBeTruthy();
  });
});
