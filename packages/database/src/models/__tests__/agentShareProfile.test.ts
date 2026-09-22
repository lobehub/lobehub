// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  agents,
  documents,
  topics,
  users,
  works,
  workspaces,
  workVersions,
} from '../../schemas';
import { AgentShareModel } from '../agentShare';
import { AgentShareProfileModel } from '../agentShareProfile';

const db = await getTestDB();
const owner = 'profile-owner';
const agent = 'profile-agent';
const creatorTopic = 'creator-topic';
const visitorTopic = 'visitor-topic';
const model = new AgentShareProfileModel(db, owner);
const shareModel = new AgentShareModel(db, owner);
const deliveredAt = new Date('2026-01-02T00:00:00Z');

const addWork = async (
  id: string,
  overrides: Partial<typeof works.$inferInsert> = {},
  topicId: string | null = creatorTopic,
) => {
  await db.insert(works).values({
    id,
    type: 'external',
    resourceType: 'github_issue',
    userId: owner,
    originAgentId: agent,
    originTopicId: creatorTopic,
    visibility: 'private',
    title: `Title ${id}`,
    description: 'A selected result',
    toolName: 'createIssue',
    toolIdentifier: 'github',
    url: 'https://github.com/example/repo/issues/1',
    ...overrides,
  });
  return addVersion(id, 1, 2, 'operation-1', topicId);
};

const addVersion = async (
  workId: string,
  version: number,
  cumulativeCost: number | null,
  rootOperationId: string | null,
  topicId: string | null = creatorTopic,
) => {
  const [row] = await db
    .insert(workVersions)
    .values({
      workId,
      version,
      cumulativeCost,
      rootOperationId,
      topicId,
      agentId: agent,
      changeType: version === 1 ? 'created' : 'updated',
      toolName: 'createIssue',
      toolIdentifier: 'github',
      createdAt: new Date(deliveredAt.getTime() + version * 1000),
    })
    .returning();
  await db.update(works).set({ currentVersionId: row.id }).where(eq(works.id, workId));
  return row;
};

beforeEach(async () => {
  await db.delete(agentOperations);
  await db.delete(users);
  await db.insert(users).values([{ id: owner }, { id: 'other-owner' }]);
  await db.insert(workspaces).values({
    id: 'profile-workspace',
    name: 'Workspace',
    slug: 'profile-workspace',
    primaryOwnerId: owner,
  });
  await db.insert(agents).values([
    { id: agent, userId: owner, slug: 'profile-agent' },
    { id: 'other-agent', userId: owner },
    { id: 'foreign-agent', userId: 'other-owner' },
  ]);
  await db.insert(topics).values([
    { id: creatorTopic, userId: owner, agentId: agent },
    { id: visitorTopic, userId: owner, agentId: agent, senderId: 'visitor-user' },
  ]);
});

afterEach(async () => {
  await db.delete(agentOperations);
  await db.delete(users);
});

describe('AgentShareProfileModel', () => {
  it('persists ordered selections, exposes only safe fields, and supports withdrawal', async () => {
    await addWork('first');
    await addWork('second');
    await shareModel.create(agent, 'link');
    await shareModel.updateConfig(agent, { featuredWorkIds: ['second', 'first'] });
    const share = await shareModel.getByAgentId(agent);
    const items = await model.listFeaturedWorks(agent, share!.shareConfig.featuredWorkIds!);
    expect(items.map(({ id }) => id)).toEqual(['second', 'first']);
    expect(Object.keys(items[0]).sort()).toEqual(
      [
        'createdAt',
        'description',
        'id',
        'identifier',
        'resourceType',
        'status',
        'title',
        'totalCost',
        'type',
        'updatedAt',
        'url',
      ].sort(),
    );
    expect(items[0].totalCost).toBe(2);
    const before = await model.getStats(agent);
    await shareModel.updateConfig(agent, { featuredWorkIds: [] });
    expect(
      await model.listFeaturedWorks(
        agent,
        (await shareModel.getByAgentId(agent))!.shareConfig.featuredWorkIds!,
      ),
    ).toEqual([]);
    expect(await model.getStats(agent)).toEqual(before);
  });

  it('rejects visitor, foreign agent/user/workspace, deleted and unknown provenance', async () => {
    await addWork('valid');
    await addWork('visitor', { originTopicId: visitorTopic }, visitorTopic);
    await addWork('foreign-agent-work', { originAgentId: 'other-agent' });
    await addWork('foreign-user-work', { userId: 'other-owner' });
    await addWork('workspace-work', { workspaceId: 'profile-workspace' });
    await addWork('deleted-work', { deletedAt: new Date() });
    await addWork('flagged-work', { isDeleted: true });
    await addWork('live-false', { isDeleted: false });
    await addWork('unknown-origin', { originTopicId: null });
    await addWork('unknown-current', {}, null);
    const invalid = [
      'visitor',
      'foreign-agent-work',
      'foreign-user-work',
      'workspace-work',
      'deleted-work',
      'flagged-work',
      'unknown-origin',
      'unknown-current',
      'missing',
    ];
    for (const id of invalid) {
      await expect(model.validateFeaturedWorks(agent, [id])).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    expect(
      (await model.listFeaturedWorks(agent, ['valid', ...invalid])).map(({ id }) => id),
    ).toEqual(['valid']);
    expect(
      await new AgentShareProfileModel(db, 'other-owner').listFeaturedWorks(agent, ['valid']),
    ).toEqual([]);
    expect((await model.getStats(agent)).workCount).toBe(2);
    await expect(model.validateFeaturedWorks(agent, ['live-false'])).resolves.toBeUndefined();
  });

  it('never republishes a visitor Work after its topic is deleted or after creator edits', async () => {
    await addWork('visitor', { originTopicId: visitorTopic }, visitorTopic);
    await db.delete(topics).where(eq(topics.id, visitorTopic));
    expect(await model.listFeaturedWorks(agent, ['visitor'])).toEqual([]);
    await db
      .insert(topics)
      .values({ id: visitorTopic, userId: owner, agentId: agent, senderId: 'visitor-user' });
    await addWork('mixed');
    await addVersion('mixed', 2, 3, 'visitor-operation', visitorTopic);
    await addVersion('mixed', 3, 4, 'creator-operation');
    expect(await model.listFeaturedWorks(agent, ['mixed'])).toEqual([]);
  });

  it('filters selections again after deletion, workspace moves, or resource removal', async () => {
    await addWork('valid');
    await model.validateFeaturedWorks(agent, ['valid']);
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, 'valid'));
    expect(await model.listFeaturedWorks(agent, ['valid'])).toEqual([]);
    await db.insert(documents).values({
      id: 'document',
      userId: owner,
      fileType: 'custom',
      sourceType: 'agent',
      source: 'test',
      totalCharCount: 0,
      totalLineCount: 0,
    });
    await addWork('document-work', {
      type: 'document',
      resourceType: 'document',
      resourceId: 'document',
    });
    await model.validateFeaturedWorks(agent, ['document-work']);
    await db.delete(documents).where(eq(documents.id, 'document'));
    expect(await model.listFeaturedWorks(agent, ['document-work'])).toEqual([]);
    await addWork('move-work');
    await db.update(agents).set({ workspaceId: 'profile-workspace' }).where(eq(agents.id, agent));
    expect(await model.listFeaturedWorks(agent, ['move-work'])).toEqual([]);
  });

  it('deduplicates operation snapshots and averages measured costs across all creator Works', async () => {
    await addWork('first');
    await addVersion('first', 2, 5, 'operation-1');
    const latest = await addVersion('first', 3, 3, 'operation-2');
    await addWork('second');
    await addWork('unmeasured');
    await db
      .update(workVersions)
      .set({ cumulativeCost: null })
      .where(eq(workVersions.workId, 'unmeasured'));
    await addWork('visitor', { originTopicId: visitorTopic }, visitorTopic);
    const stats = await model.getStats(agent);
    expect(stats.workCount).toBe(3);
    expect(stats.averageWorkCost).toBe(5);
    expect(stats.lastDeliveredAt).toEqual(latest.createdAt);
    const items = await model.listFeaturedWorks(agent, ['first', 'second', 'unmeasured']);
    expect(items.map(({ totalCost }) => totalCost)).toEqual([8, 2, null]);
    await shareModel.create(agent);
    await shareModel.updateConfig(agent, { featuredWorkIds: ['second'] });
    expect(await model.getStats(agent)).toEqual(stats);
  });

  it('keeps zero measured cost and handles versions without an operation id independently', async () => {
    await addWork('first');
    await db
      .update(workVersions)
      .set({ cumulativeCost: 0 })
      .where(eq(workVersions.workId, 'first'));
    expect((await model.getStats(agent)).averageWorkCost).toBe(0);
    await addVersion('first', 2, 2, null);
    await addVersion('first', 3, 3, null);
    expect((await model.getStats(agent)).averageWorkCost).toBe(5);
  });

  it('averages valid finished operations and excludes in-flight, invalid and foreign samples', async () => {
    const startedAt = new Date('2026-01-01T00:00:00Z');
    const operation = (
      id: string,
      seconds: number,
      overrides: Partial<typeof agentOperations.$inferInsert> = {},
    ) => ({
      id,
      userId: owner,
      agentId: agent,
      topicId: creatorTopic,
      status: 'done' as const,
      startedAt,
      completedAt: new Date(startedAt.getTime() + seconds * 1000),
      ...overrides,
    });
    await db
      .insert(agentOperations)
      .values([
        operation('first', 10),
        operation('second', 30, { status: 'error' }),
        operation('running', 500, { status: 'running' }),
        operation('missing', 500, { startedAt: null }),
        operation('negative', -10),
        operation('visitor', 500, { topicId: visitorTopic }),
        operation('other-agent', 500, { agentId: 'other-agent' }),
        operation('other-owner', 500, { userId: 'other-owner' }),
        operation('workspace', 500, { workspaceId: 'profile-workspace' }),
      ]);
    expect((await model.getStats(agent)).averageOperationDurationSeconds).toBe(20);
    expect(
      (await new AgentShareProfileModel(db, 'other-owner').getStats(agent))
        .averageOperationDurationSeconds,
    ).toBeNull();
  });

  it('returns null for absent measurements and removes unsafe URLs', async () => {
    expect(await model.getStats(agent)).toEqual({
      workCount: 0,
      lastDeliveredAt: null,
      averageWorkCost: null,
      averageOperationDurationSeconds: null,
    });
    await addWork('unsafe-url', { url: 'javascript:alert(1)' });
    await db
      .update(workVersions)
      .set({ cumulativeCost: null })
      .where(eq(workVersions.workId, 'unsafe-url'));
    expect((await model.getStats(agent)).averageWorkCost).toBeNull();
    expect((await model.listFeaturedWorks(agent, ['unsafe-url']))[0].url).toBeNull();
  });

  it('stops exposing profile data for a trashed agent', async () => {
    await addWork('first');
    await db.update(agents).set({ isDeleted: true }).where(eq(agents.id, agent));
    expect(await model.listFeaturedWorks(agent, ['first'])).toEqual([]);
    expect((await model.getStats(agent)).workCount).toBe(0);
  });
});
