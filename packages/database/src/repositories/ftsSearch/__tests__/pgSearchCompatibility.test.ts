// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messages, topics, users, workspaces } from '../../../schemas';
import { PgSearchFtsSearchBackend } from '../pgSearch';

const db = await getTestDB();
const userId = 'pg-search-compat-user';
const otherUserId = 'pg-search-compat-other';
const agentId = 'pg-search-compat-agent';
const otherAgentId = 'pg-search-compat-other-agent';
const workspaceId = 'pg-search-compat-workspace';
const deletedAt = new Date('2026-01-01');

describe.skipIf(process.env.TEST_SERVER_DB !== '1')('pg_search scored scan compatibility', () => {
  const cleanup = async () => {
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  };

  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Search compatibility',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await db.insert(agents).values([
      { id: agentId, userId },
      { id: otherAgentId, userId },
    ]);
    await db.insert(topics).values([
      { agentId, id: 'compat-null', title: 'Terraform', userId },
      { agentId, content: 'Terraform', id: 'compat-false', isDeleted: false, userId },
      { agentId, description: 'Terraform', id: 'compat-description', userId },
      { agentId, deletedAt, id: 'compat-trash', isDeleted: true, title: 'Terraform', userId },
      { agentId, id: 'compat-foreign', title: 'Terraform', userId: otherUserId },
      { agentId, id: 'compat-workspace', title: 'Terraform', userId, workspaceId },
      { agentId: otherAgentId, id: 'compat-other-agent', title: 'Terraform', userId },
      { agentId, id: 'compat-visitor', senderId: 'visitor', title: 'Terraform', userId },
    ]);
  });

  afterAll(cleanup);

  it('filters deleted hits before the candidate cutoff', async () => {
    await db.insert(topics).values(
      Array.from({ length: 501 }, (_, index) => ({
        deletedAt,
        id: `compat-trash-${index}`,
        isDeleted: true,
        title: 'Terraform',
        userId,
      })),
    );
    const response = await new PgSearchFtsSearchBackend(db, { userId }).search({
      entity: 'topics',
      filters: {},
      pagination: { limit: 1 },
      query: { text: 'Terraform' },
      scope: { userId },
    });

    expect(response.items).toHaveLength(1);
    expect(['compat-null', 'compat-false', 'compat-description', 'compat-other-agent']).toContain(
      response.items[0].id,
    );
    expect(response.candidates.every(({ score }) => score > 0)).toBe(true);
  });

  it('scores workspace topics without restricting results to their creator', async () => {
    await db.insert(topics).values({
      id: 'compat-workspace-other-creator',
      title: 'Terraform',
      userId: otherUserId,
      workspaceId,
    });
    const scope = { userId, workspaceId };
    const response = await new PgSearchFtsSearchBackend(db, scope).search({
      entity: 'topics',
      filters: {},
      pagination: { limit: 10 },
      query: { text: 'Terraform' },
      scope,
    });

    expect(response.items.map(({ id }) => id).sort()).toEqual([
      'compat-workspace',
      'compat-workspace-other-creator',
    ]);
    for (const candidate of response.candidates) expect(candidate.score).toBeGreaterThan(0);
  });

  it.each([undefined, agentId])('scores all topic fields with agent filter %s', async (filter) => {
    const response = await new PgSearchFtsSearchBackend(db, { userId }).search({
      entity: 'topics',
      filters: { agentId: filter },
      pagination: { limit: 10 },
      query: { text: 'Terraform' },
      scope: { userId },
    });

    expect(response.items.map(({ id }) => id).sort()).toEqual(
      [
        'compat-null',
        'compat-false',
        'compat-description',
        ...(filter ? [] : ['compat-other-agent']),
      ].sort(),
    );
    expect(response.candidates).toHaveLength(response.items.length);
    // NULL scores on older pg_search releases must not silently flatten ranking.
    for (const candidate of response.candidates) expect(candidate.score).toBeGreaterThan(0);
  });

  it.each([undefined, agentId])(
    'scores messages and retains parent visibility with agent filter %s',
    async (filter) => {
      const base = { agentId, content: 'Terraform', role: 'user', userId };
      await db.insert(messages).values([
        { ...base, id: 'compat-msg-null' },
        { ...base, id: 'compat-msg-false', isDeleted: false, topicId: 'compat-null' },
        { ...base, deletedAt, id: 'compat-msg-trash', isDeleted: true },
        { ...base, id: 'compat-msg-foreign', userId: otherUserId },
        { ...base, id: 'compat-msg-workspace', workspaceId },
        { ...base, agentId: otherAgentId, id: 'compat-msg-other-agent' },
        { ...base, id: 'compat-msg-visitor', topicId: 'compat-visitor' },
        { ...base, id: 'compat-msg-trashed-parent', topicId: 'compat-trash' },
        { ...base, id: 'compat-msg-foreign-parent', topicId: 'compat-foreign' },
        { ...base, id: 'compat-msg-tool', role: 'tool' },
      ]);
      const response = await new PgSearchFtsSearchBackend(db, { userId }).search({
        entity: 'messages',
        filters: { agentId: filter },
        pagination: { limit: 10 },
        query: { text: 'Terraform' },
        scope: { userId },
      });

      expect(response.items.map(({ id }) => id).sort()).toEqual(
        [
          'compat-msg-null',
          'compat-msg-false',
          ...(filter ? [] : ['compat-msg-other-agent']),
        ].sort(),
      );
      for (const candidate of response.candidates) expect(candidate.score).toBeGreaterThan(0);
    },
  );
});
