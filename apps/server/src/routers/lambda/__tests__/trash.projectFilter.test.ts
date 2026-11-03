// @vitest-environment node
import { TRASH_EMPTY_BATCH_SIZE } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ProjectModel } from '@/database/models/project';
import { TopicModel } from '@/database/models/topic';
import { agents, topics, trashItems, users, workspaces } from '@/database/schemas';
import { TrashService } from '@/server/services/trash';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ deleteFile: vi.fn(), deleteFiles: vi.fn() })),
}));

const { trashRouter } = await import('../trash');

const ownerId = 'trash-filter-owner';
const memberId = 'trash-filter-member';
const strangerId = 'trash-filter-stranger';
const workspaceId = 'trash-filter-ws';
const otherWorkspaceId = 'trash-filter-ws-2';

const personalCtx = (userId: string) => ({ userId }) as any;
const workspaceCtx = (
  userId: string,
  workspaceRole: 'admin' | 'member' | 'owner',
  ws = workspaceId,
) => ({ userId, workspaceId: ws, workspaceRole }) as any;

const createProject = (
  userId: string,
  ws: string | undefined,
  identifier: string,
  visibility?: 'private' | 'public',
) => new ProjectModel(testDB, userId, ws).create({ identifier, name: identifier, visibility });

/** Create topics under a project (or none) and trash each as its own root, oldest first. */
const trashTopics = async (
  userId: string,
  ws: string | undefined,
  projectId: string | null,
  count = 1,
) => {
  const topicModel = new TopicModel(testDB, userId, ws);
  const service = new TrashService(testDB, userId, ws);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const topic = await topicModel.create({ projectId, title: `${projectId ?? 'none'} ${i}` });
    await service.trashTopics([topic.id]);
    ids.push(topic.id);
  }
  return ids;
};

/** Trash an agent whose cascade carries topics recorded under `projectId`. */
const trashAgentWithProjectTopics = async (
  userId: string,
  ws: string | undefined,
  projectId: string,
) => {
  const agent = await new AgentModel(testDB, userId, ws).create({ title: 'agent' });
  const topic = await new TopicModel(testDB, userId, ws).create({ agentId: agent.id, projectId });
  await new TrashService(testDB, userId, ws).trashAgent(agent.id);
  return { agentId: agent.id, topicId: topic.id };
};

const listIds = async (ctx: any, input: Parameters<ReturnType<typeof caller>['list']>[0] = {}) => {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<ReturnType<typeof caller>['list']>> = await caller(ctx).list({
      ...input,
      cursor,
      limit: 3,
    });
    ids.push(...page.items.map((item) => item.resourceId));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
};

const caller = (ctx: any) => trashRouter.createCaller(ctx);

beforeEach(async () => {
  testDB = await getTestDB();
  await testDB.delete(users);
  await testDB.insert(users).values([{ id: ownerId }, { id: memberId }, { id: strangerId }]);
  await testDB.insert(workspaces).values([
    { id: workspaceId, name: 'ws', primaryOwnerId: ownerId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'ws2', primaryOwnerId: ownerId, slug: otherWorkspaceId },
  ]);
});

afterEach(async () => {
  vi.clearAllMocks();
  await testDB.delete(users);
});

describe('trashRouter project filter', () => {
  it('lists and counts all, no project and one project across pages in personal scope', async () => {
    const alpha = await createProject(ownerId, undefined, 'ALPHA');
    const beta = await createProject(ownerId, undefined, 'BETA');
    const alphaIds = await trashTopics(ownerId, undefined, alpha.id, 7);
    const betaIds = await trashTopics(ownerId, undefined, beta.id, 2);
    const noneIds = await trashTopics(ownerId, undefined, null, 2);
    const { agentId, topicId } = await trashAgentWithProjectTopics(ownerId, undefined, alpha.id);
    const ctx = personalCtx(ownerId);

    const alphaListed = await listIds(ctx, { projectId: alpha.id });
    expect(alphaListed.sort()).toEqual([...alphaIds].sort());
    expect(await caller(ctx).countByType({ projectId: alpha.id })).toEqual({ topic: 7 });

    // The agent root is never in a project, and its cascaded project topic is not a root.
    const none = await listIds(ctx, { projectId: null });
    expect(none.sort()).toEqual([...noneIds, agentId].sort());
    expect(none).not.toContain(topicId);
    expect(await caller(ctx).countByType({ projectId: null })).toEqual({ agent: 1, topic: 2 });

    const all = await listIds(ctx);
    expect(all).toHaveLength(alphaIds.length + betaIds.length + noneIds.length + 1);
    expect(new Set(all).size).toBe(all.length);
    expect(await caller(ctx).countByType()).toEqual({ agent: 1, topic: 11 });
    expect(await listIds(ctx, { projectId: beta.id, resourceType: 'agent' })).toEqual([]);
  });

  it('keeps rows of a deleted project under All and refuses the deleted project as a filter', async () => {
    const gone = await createProject(ownerId, undefined, 'GONE');
    const [orphan] = await trashTopics(ownerId, undefined, gone.id);
    await new ProjectModel(testDB, ownerId).delete(gone.id);
    const ctx = personalCtx(ownerId);

    expect(await listIds(ctx)).toEqual([orphan]);
    // Recorded under a project, so it is not "no project" either.
    expect(await listIds(ctx, { projectId: null })).toEqual([]);
    for (const run of [
      () => caller(ctx).list({ projectId: gone.id }),
      () => caller(ctx).countByType({ projectId: gone.id }),
      () => caller(ctx).emptyTrash({ projectId: gone.id, workspaceId: null }),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await listIds(ctx)).toEqual([orphan]);
  });

  it('refuses projects outside the caller scope or visibility without revealing their rows', async () => {
    const personal = await createProject(ownerId, undefined, 'MINE');
    const strangers = await createProject(strangerId, undefined, 'THEIRS');
    const shared = await createProject(ownerId, workspaceId, 'TEAM');
    const memberPrivate = await createProject(memberId, workspaceId, 'SECRET', 'private');
    const elsewhere = await createProject(ownerId, otherWorkspaceId, 'ELSE');
    await trashTopics(memberId, workspaceId, memberPrivate.id);
    await trashTopics(strangerId, undefined, strangers.id);

    const forged: [any, string][] = [
      // another user's personal project, and a workspace project, from personal scope
      [personalCtx(ownerId), strangers.id],
      [personalCtx(ownerId), shared.id],
      // a personal project and another workspace's project from inside a workspace
      [workspaceCtx(ownerId, 'owner'), personal.id],
      [workspaceCtx(ownerId, 'owner'), elsewhere.id],
      // the owner cannot read a member's private project, so cannot filter by it
      [workspaceCtx(ownerId, 'owner'), memberPrivate.id],
      [workspaceCtx(strangerId, 'member'), memberPrivate.id],
      ['personal-stranger', personal.id],
    ];
    for (const [ctx, projectId] of forged) {
      const resolved = ctx === 'personal-stranger' ? personalCtx(strangerId) : ctx;
      await expect(caller(resolved).list({ projectId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(caller(resolved).countByType({ projectId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        caller(resolved).emptyTrash({ projectId, workspaceId: resolved.workspaceId ?? null }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    // Nothing was swept by the refused calls.
    expect(await testDB.select().from(trashItems)).toHaveLength(2);
    // The member who owns the private project filters by it normally.
    expect(
      await caller(workspaceCtx(memberId, 'member')).countByType({ projectId: memberPrivate.id }),
    ).toEqual({ topic: 1 });
  });

  it('shows every member the public side and keeps a request without a side to own roots', async () => {
    const team = await createProject(ownerId, workspaceId, 'TEAM');
    const ownerRoots = await trashTopics(ownerId, workspaceId, team.id, 2);
    const memberRoots = await trashTopics(memberId, workspaceId, team.id, 2);
    await trashTopics(memberId, workspaceId, null, 1);

    const owner = workspaceCtx(ownerId, 'owner');
    const member = workspaceCtx(memberId, 'member');
    for (const ctx of [owner, member]) {
      expect((await listIds(ctx, { projectId: team.id, visibility: 'public' })).sort()).toEqual(
        [...ownerRoots, ...memberRoots].sort(),
      );
      expect(await caller(ctx).countByType({ projectId: null, visibility: 'public' })).toEqual({
        topic: 1,
      });
      expect(await caller(ctx).countByType({ visibility: 'private' })).toEqual({});
    }
    // Without a side, older clients still get only their own deletions.
    expect((await listIds(owner, { projectId: team.id })).sort()).toEqual([...ownerRoots].sort());
    expect(await caller(owner).countByType({ projectId: null })).toEqual({});
    // The personal bin of the same user is a different scope with no sides.
    expect(await listIds(personalCtx(ownerId), { projectId: null, visibility: 'public' })).toEqual(
      [],
    );
  });

  it('empties only the matching roots of type, actor and project, each with its whole cascade', async () => {
    const team = await createProject(ownerId, workspaceId, 'TEAM');
    const other = await createProject(ownerId, workspaceId, 'OTHER');
    const ownerTeam = await trashTopics(ownerId, workspaceId, team.id, 1);
    const memberTeam = await trashTopics(
      memberId,
      workspaceId,
      team.id,
      TRASH_EMPTY_BATCH_SIZE + 2,
    );
    const memberOther = await trashTopics(memberId, workspaceId, other.id, 1);
    const memberAgent = await trashAgentWithProjectTopics(memberId, workspaceId, team.id);
    const member = workspaceCtx(memberId, 'member');

    // A type that matches nothing in the project leaves everything in place.
    expect(
      await caller(member).emptyTrash({ projectId: team.id, resourceType: 'agent', workspaceId }),
    ).toEqual({ blocked: 0, hasMore: false, purged: 0 });

    let purged = 0;
    for (;;) {
      const batch = await caller(member).emptyTrash({
        projectId: team.id,
        resourceType: 'topic',
        workspaceId,
      });
      purged += batch.purged;
      if (!batch.hasMore) break;
    }
    expect(purged).toBe(memberTeam.length);
    expect((await listIds(member)).sort()).toEqual([...memberOther, memberAgent.agentId].sort());
    expect(await listIds(workspaceCtx(ownerId, 'owner'))).toEqual(ownerTeam);
    // The agent's cascaded team topic is not a root of the project, so it survived…
    expect(
      await testDB.select().from(topics).where(eq(topics.id, memberAgent.topicId)),
    ).toHaveLength(1);
    expect(await testDB.select().from(topics).where(inArray(topics.id, memberTeam))).toHaveLength(
      0,
    );

    // …and emptying "no project" takes the agent root with its whole cascade.
    expect(await caller(member).emptyTrash({ projectId: null, workspaceId })).toEqual({
      blocked: 0,
      hasMore: false,
      purged: 1,
    });
    expect(
      await testDB.select().from(topics).where(eq(topics.id, memberAgent.topicId)),
    ).toHaveLength(0);
    expect(await listIds(member)).toEqual(memberOther);
    expect(await listIds(workspaceCtx(ownerId, 'owner'))).toEqual(ownerTeam);
  });

  it('keeps private deletions on the deleter’s private side, out of every manager’s reach', async () => {
    const privateAgent = await new AgentModel(testDB, memberId, workspaceId).create({
      title: 'secret agent',
      visibility: 'private',
    });
    await new TopicModel(testDB, memberId, workspaceId).create({
      agentId: privateAgent.id,
      title: 'secret topic',
    });
    await new TrashService(testDB, memberId, workspaceId).trashAgent(privateAgent.id);
    // A topic of a private agent is private too, even trashed on its own.
    const otherPrivateAgent = await new AgentModel(testDB, memberId, workspaceId).create({
      visibility: 'private',
    });
    const privateTopic = await new TopicModel(testDB, memberId, workspaceId).create({
      agentId: otherPrivateAgent.id,
    });
    await new TrashService(testDB, memberId, workspaceId).trashTopics([privateTopic.id]);
    const privateProject = await createProject(memberId, workspaceId, 'MINE', 'private');
    const [projectTopic] = await trashTopics(memberId, workspaceId, privateProject.id, 1);
    const [publicTopic] = await trashTopics(memberId, workspaceId, null, 1);

    const member = workspaceCtx(memberId, 'member');
    const admin = workspaceCtx(strangerId, 'admin');
    const owner = workspaceCtx(ownerId, 'owner');

    expect((await listIds(member, { visibility: 'private' })).sort()).toEqual(
      [privateAgent.id, privateTopic.id, projectTopic].sort(),
    );
    expect(await listIds(member, { visibility: 'public' })).toEqual([publicTopic]);
    for (const manager of [admin, owner]) {
      expect(await listIds(manager, { visibility: 'public' })).toEqual([publicTopic]);
      expect(await listIds(manager, { visibility: 'private' })).toEqual([]);
      expect(await caller(manager).countByType({ visibility: 'public' })).toEqual({ topic: 1 });
    }

    const registry = await testDB.select().from(trashItems);
    const rowOf = (resourceId: string) => registry.find((row) => row.resourceId === resourceId)!.id;
    for (const manager of [admin, owner]) {
      await expect(
        caller(manager).restore({ ids: [rowOf(privateAgent.id)] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(manager).purge({ ids: [rowOf(projectTopic)] })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    // Emptying the public side leaves every private deletion in place.
    expect(await caller(admin).emptyTrash({ visibility: 'public', workspaceId })).toEqual({
      blocked: 0,
      hasMore: false,
      purged: 1,
    });
    expect(await testDB.select().from(agents).where(eq(agents.id, privateAgent.id))).toHaveLength(
      1,
    );
    expect((await listIds(member, { visibility: 'private' })).sort()).toEqual(
      [privateAgent.id, privateTopic.id, projectTopic].sort(),
    );
  });

  it('lets managers, not other members, manage and empty the public side', async () => {
    const [memberTopic] = await trashTopics(memberId, workspaceId, null, 1);
    const [ownerTopic] = await trashTopics(ownerId, workspaceId, null, 1);
    const registry = await testDB.select().from(trashItems);
    const rowOf = (resourceId: string) => registry.find((row) => row.resourceId === resourceId)!.id;
    const member = workspaceCtx(memberId, 'member');
    const admin = workspaceCtx(strangerId, 'admin');

    await expect(caller(member).purge({ ids: [rowOf(ownerTopic)] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      caller(member).emptyTrash({ visibility: 'public', workspaceId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await caller(admin).restore({ ids: [rowOf(memberTopic)] })).toMatchObject({
      failed: [],
    });
    await caller(admin).purge({ ids: [rowOf(ownerTopic)] });
    expect(await listIds(member, { visibility: 'public' })).toEqual([]);
    expect(await testDB.select().from(topics).where(eq(topics.id, memberTopic))).toHaveLength(1);
  });

  it('refuses a batch whose request scope no longer matches the scope the sweep started in', async () => {
    const roots = await trashTopics(ownerId, undefined, null, 2);
    await trashTopics(ownerId, workspaceId, null, 1);

    await expect(
      caller(workspaceCtx(ownerId, 'owner')).emptyTrash({ workspaceId: null }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(caller(personalCtx(ownerId)).emptyTrash({ workspaceId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(await testDB.select().from(trashItems)).toHaveLength(3);

    expect(await caller(personalCtx(ownerId)).emptyTrash({ workspaceId: null })).toEqual({
      blocked: 0,
      hasMore: false,
      purged: roots.length,
    });
  });
});
