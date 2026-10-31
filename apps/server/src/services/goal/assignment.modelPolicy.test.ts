// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as businessAiProvider from '@/business/server/aiProvider';
import { getTestDB } from '@/database/core/getTestDB';
import { TaskModel } from '@/database/models/task';
import {
  agents,
  aiModels,
  aiProviders,
  goals,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import * as featureFlags from '@/server/featureFlags';

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
    // A goal from before goal visibility: public, over the member's private work.
    await db.update(goals).set({ visibility: 'public' }).where(eq(goals.id, graph.goal.id));

    // The Workspace owner acts on the member's goal; the Task is still the member's.
    await new GoalAssignmentService(db, authorId, workspaceId).setTaskModel(graph.goal.id, gemini);

    expect((await ownTask())?.config).toMatchObject({ model: 'gemini-3.8-flash' });
  });

  it("falls back to the member's private executor's model when an admin clears the Task model", async () => {
    const privateExecutorId = `goal-policy-private-exec-${randomUUID()}`;
    await db.insert(agents).values({
      id: privateExecutorId,
      model: 'deepseek-chat',
      provider: 'deepseek',
      slug: `private-exec-${randomUUID()}`,
      userId: memberId,
      visibility: 'private',
      workspaceId,
    });
    const memberGoals = new GoalService(db, memberId, workspaceId);
    const graph = await memberGoals.create({
      agentId: openAgentId,
      config: { taskAgentId: privateExecutorId },
      tasks: ['Only task'],
      title: 'Private executor',
    });
    const { taskId } = await memberGoals.tick(graph.goal.id);
    const ownTask = () => new TaskModel(db, memberId, workspaceId).findById(taskId!);
    expect((await ownTask())?.assigneeAgentId).toBe(privateExecutorId);
    // A goal from before goal visibility: public, over a private executor.
    await db.update(goals).set({ visibility: 'public' }).where(eq(goals.id, graph.goal.id));

    const admin = new GoalAssignmentService(db, authorId, workspaceId);
    await admin.setTaskModel(graph.goal.id, gemini);
    await admin.setTaskModel(graph.goal.id, null);

    // The executor is still the member's private Agent, invisible to the admin.
    expect((await ownTask())?.config).toMatchObject({
      model: 'deepseek-chat',
      provider: 'deepseek',
    });
  });

  it("refuses an admin's pick of a model the goal's owner cannot use", async () => {
    // The member's plan hides the model the admin's picker still offers.
    vi.spyOn(businessAiProvider, 'getHiddenBuiltinModelsForUser').mockImplementation(
      async (userId) => (userId === memberId ? [{ id: gemini.model, providerId: 'google' }] : []),
    );
    const goalId = await goalFor(memberId, openAgentId);
    const admin = new GoalAssignmentService(db, authorId, workspaceId);

    // The goal runs as the member, who could not run that model.
    await expect(admin.setModel(goalId, gemini)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(admin.setTaskModel(goalId, gemini)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    // A model the member can run is still fine.
    await db.insert(aiModels).values({
      enabled: true,
      id: 'gemini-team',
      providerId: 'google',
      userId: authorId,
      workspaceId,
    });
    await expect(
      admin.setModel(goalId, { model: 'gemini-team', provider: 'google' }),
    ).resolves.toBeTruthy();
  });

  it('refuses a device-only provider for planning, but not for Tasks', async () => {
    vi.spyOn(featureFlags, 'getServerFeatureFlagsStateFromRuntimeConfig').mockResolvedValue({
      enableLlmRelay: true,
    } as Awaited<ReturnType<typeof featureFlags.getServerFeatureFlagsStateFromRuntimeConfig>>);
    await db.insert(aiProviders).values({
      enabled: true,
      fetchOnClient: true,
      id: 'ollama',
      source: 'builtin',
      userId: memberId,
      workspaceId,
    });
    await db.insert(aiModels).values({
      enabled: true,
      id: 'llama3.1',
      providerId: 'ollama',
      userId: memberId,
      workspaceId,
    });
    const goalId = await goalFor(memberId, openAgentId);
    const local = { model: 'llama3.1', provider: 'ollama' };
    const member = new GoalAssignmentService(db, memberId, workspaceId);

    // Planning advances in the background, with no device to reach it.
    await expect(member.setModel(goalId, local)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(member.setTaskModel(goalId, local)).resolves.toBeTruthy();
  });

  it("refuses to hand a member's goal to an admin's private Agent", async () => {
    const adminPrivateId = `goal-policy-admin-private-${randomUUID()}`;
    await db.insert(agents).values({
      id: adminPrivateId,
      slug: `admin-private-${randomUUID()}`,
      userId: authorId,
      visibility: 'private',
      workspaceId,
    });
    const goalId = await goalFor(memberId, openAgentId);
    const admin = new GoalAssignmentService(db, authorId, workspaceId);

    // The member's background runs could never reach the admin's private Agent.
    await expect(admin.setAgent(goalId, adminPrivateId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(admin.setTaskAgent(goalId, adminPrivateId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // A shared Agent the member can use is still fine.
    await expect(admin.setAgent(goalId, fixedAgentId)).resolves.toBeTruthy();
  });
});
