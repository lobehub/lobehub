// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, knowledgeBases, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectRouter } from '../../project';
import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

describe('Project Router Integration', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let caller: ReturnType<typeof projectRouter.createCaller>;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    caller = projectRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  it('serves the complete project management and human review flow', async () => {
    const created = await caller.create({
      identifier: 'apollo',
      name: 'Apollo',
      visibility: 'private',
    });
    expect(created.data.identifier).toBe('APOLLO');
    expect(created.data.coordinatorAgentId).toBeTruthy();
    await caller.updateStatus({ id: created.data.id, status: 'active' });

    const [agent] = await serverDB.insert(agents).values({ title: 'Lead', userId }).returning();
    const [knowledgeBase] = await serverDB
      .insert(knowledgeBases)
      .values({ name: 'Mission data', userId })
      .returning();
    await caller.addAgent({ agentId: agent.id, id: created.data.id, role: 'lead' });
    await caller.addKnowledgeBase({ id: created.data.id, knowledgeBaseId: knowledgeBase.id });

    const taskCaller = taskRouter.createCaller(createTestContext(userId));
    const task = await taskCaller.create({
      instruction: 'Prepare launch',
      projectId: created.data.id,
    });
    const detail = await caller.detail({ id: created.data.id });
    expect(detail.data.agents).toHaveLength(2);
    expect(detail.data.agents).toContainEqual(
      expect.objectContaining({
        agent: expect.objectContaining({ id: created.data.coordinatorAgentId }),
        binding: expect.objectContaining({ role: 'coordinator' }),
      }),
    );
    expect(detail.data.knowledgeBases).toHaveLength(1);
    expect(detail.data.tasks?.[0].id).toBe(task.data.id);
    expect(detail.data.permissions).toEqual({
      canManage: true,
      canManageKnowledgeBases: true,
      canManageMembers: true,
    });

    const updatedAgent = await caller.updateAgent({
      agentId: agent.id,
      id: created.data.id,
      responsibility: 'Owns the launch plan',
    });
    expect(updatedAgent.data).toEqual(
      expect.objectContaining({ responsibility: 'Owns the launch plan', role: 'lead' }),
    );
    const updatedKnowledgeBase = await caller.updateKnowledgeBase({
      enabled: false,
      id: created.data.id,
      knowledgeBaseId: knowledgeBase.id,
    });
    expect(updatedKnowledgeBase.data.enabled).toBe(false);
    await expect(
      caller.updateAgent({ agentId: 'missing-agent', id: created.data.id, role: 'x' }),
    ).rejects.toThrow('Binding not found');

    await caller.requestCompletion({ id: created.data.id });
    const completed = await caller.acceptCompletion({
      comment: 'Human approved',
      id: created.data.id,
    });
    expect(completed.data.project.status).toBe('completed');
    expect(completed.data.review.reviewerUserId).toBe(userId);

    const reopened = await caller.reopen({ id: created.data.id });
    expect(reopened.data.status).toBe('active');
  });

  it('rejects cross-project task dependencies', async () => {
    const first = await caller.create({ identifier: 'FIRST', name: 'First' });
    const second = await caller.create({ identifier: 'SECOND', name: 'Second' });
    const taskCaller = taskRouter.createCaller(createTestContext(userId));
    const firstTask = await taskCaller.create({ instruction: 'First', projectId: first.data.id });
    const secondTask = await taskCaller.create({
      instruction: 'Second',
      projectId: second.data.id,
    });

    await expect(
      taskCaller.addDependency({ dependsOnId: secondTask.data.id, taskId: firstTask.data.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('requires a valid project identifier', async () => {
    await expect(caller.create({ identifier: 'not-valid!', name: 'Invalid' })).rejects.toThrow(
      'Invalid project identifier',
    );
  });

  it.each(['team/launch', 'roadmap?draft', '#plan', 'two--hyphens'])(
    'rejects the route-unsafe slug %s when creating a project',
    async (slug) => {
      await expect(
        caller.create({ identifier: 'VALID', name: 'Invalid slug', slug }),
      ).rejects.toThrow('Invalid project slug');
    },
  );

  it.each(['team/launch', 'roadmap?draft', '#plan', 'two--hyphens'])(
    'rejects the route-unsafe slug %s when updating a project',
    async (slug) => {
      const project = await caller.create({
        identifier: 'VALID',
        name: 'Valid project',
        slug: 'valid-project',
      });

      await expect(caller.update({ id: project.data.id, slug })).rejects.toThrow(
        'Invalid project slug',
      );
    },
  );

  it('accepts underscores in project slugs', async () => {
    const project = await caller.create({
      identifier: 'VALID',
      name: 'Valid project',
      slug: 'team_launch',
    });
    expect(project.data.slug).toBe('team_launch');

    const updated = await caller.update({ id: project.data.id, slug: 'team_launch_v2' });
    expect(updated.data.slug).toBe('team_launch_v2');
  });

  it('lets a workspace member manage a project another member created', async () => {
    const workspaceId = 'project-teammate-workspace';
    const teammateId = await createTestUser(serverDB);
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Teammates', primaryOwnerId: userId, slug: workspaceId });
    const memberCaller = (id: string) =>
      projectRouter.createCaller({
        ...createTestContext(id),
        workspaceId,
        workspaceRole: 'member' as const,
      });
    const project = await memberCaller(userId).create({ identifier: 'TEAM', name: 'Team' });
    const teammate = memberCaller(teammateId);

    try {
      const detail = await teammate.detail({ id: project.data.id });
      expect(detail.data.permissions).toEqual({
        canManage: true,
        canManageKnowledgeBases: true,
        canManageMembers: false,
      });

      const renamed = await teammate.update({ id: project.data.id, name: 'Renamed' });
      expect(renamed.data.name).toBe('Renamed');
      await expect(
        teammate.update({ id: project.data.id, visibility: 'private' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const task = await taskRouter
        .createCaller({ ...createTestContext(teammateId), workspaceId, workspaceRole: 'member' })
        .create({ instruction: 'Help the team', projectId: project.data.id });
      expect(task.data.projectId).toBe(project.data.id);

      await teammate.updateStatus({ id: project.data.id, status: 'active' });
      await teammate.requestCompletion({ id: project.data.id });
      const accepted = await teammate.acceptCompletion({ id: project.data.id });
      expect(accepted.data.project.status).toBe('completed');
      await teammate.reopen({ id: project.data.id });

      await teammate.delete({ id: project.data.id });
      await expect(memberCaller(userId).detail({ id: project.data.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      await cleanupTestUser(serverDB, teammateId);
    }
  });

  it('reports no management permissions to a workspace viewer, even the creator', async () => {
    const workspaceId = 'project-viewer-workspace';
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Viewer', primaryOwnerId: userId, slug: workspaceId });
    const workspaceContext = (workspaceRole: 'member' | 'viewer') => ({
      ...createTestContext(userId),
      workspaceId,
      workspaceRole,
    });
    const project = await projectRouter
      .createCaller(workspaceContext('member'))
      .create({ identifier: 'VIEW', name: 'Viewed' });

    const detail = await projectRouter
      .createCaller(workspaceContext('viewer'))
      .detail({ id: project.data.id });
    expect(detail.data.permissions).toEqual({
      canManage: false,
      canManageKnowledgeBases: false,
      canManageMembers: false,
    });
  });
});
