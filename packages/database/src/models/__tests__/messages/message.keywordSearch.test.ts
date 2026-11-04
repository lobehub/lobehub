import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, chatGroups, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { buildMessageSnippet, MESSAGE_KEYWORD_SEARCH_CANDIDATE_POOL } from '../../message/search';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-keyword-search-test';
const otherUserId = 'message-keyword-search-test-other';

/**
 * Keyword retrieval belongs to the provider (BM25 needs pg_search, which PGlite
 * lacks), so these tests hand back every seeded row as a candidate and assert
 * the filters, projection and paging applied by PostgreSQL hydration.
 */
const modelWithCandidates = (ids: string[]) =>
  new MessageModel(serverDB, userId, undefined, {
    ftsSearchCandidateEnabled: true,
    ftsSearchCandidates: vi.fn().mockResolvedValue({
      candidates: ids.map((id) => ({ id, score: 1 })),
      total: ids.length,
    }),
  });

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([{ id: 'kw-agent', title: 'Agent', userId }]);
  await serverDB.insert(topics).values([
    { id: 'kw-chat', title: 'Weekly planning', trigger: 'chat', userId },
    { id: 'kw-task', title: 'T-472 daily report', trigger: 'task', userId },
    { id: 'kw-eval', title: 'BrowseComp', trigger: 'eval', userId },
    { id: 'kw-doc', title: 'Doc chat', trigger: 'document', userId },
    // Verifier topics: no trigger, but always started under a task.
    { id: 'kw-verify', metadata: { taskId: 'task_kw' }, title: 'Check to verify', userId },
    // A plain chat that happens to have no trigger stays searchable.
    { id: 'kw-legacy', title: 'Legacy chat', userId },
  ]);
});

const seed = async (rows: (typeof messages.$inferInsert)[]) => {
  await serverDB.insert(messages).values(rows);
  return modelWithCandidates(rows.map(({ id }) => id!));
};

describe('MessageModel.searchByKeyword', () => {
  it('returns topic titles, snippets and recency order, scoped to the caller', async () => {
    const messageModel = await seed([
      {
        content: 'older note about replica rollout',
        createdAt: new Date('2026-10-12T00:00:00.000Z'),
        id: 'kw-old',
        role: 'user',
        topicId: 'kw-chat',
        userId,
      },
      {
        content: 'newer replica summary',
        createdAt: new Date('2026-10-15T00:00:00.000Z'),
        id: 'kw-new',
        role: 'assistant',
        topicId: 'kw-chat',
        userId,
      },
      { content: 'replica from someone else', id: 'kw-other', role: 'user', userId: otherUserId },
    ]);

    const result = await messageModel.searchByKeyword({ keyword: 'replica' });

    expect(result.hasMore).toBe(false);
    expect(result.items.map(({ id }) => id)).toEqual(['kw-new', 'kw-old']);
    expect(result.items[0]).toMatchObject({
      role: 'assistant',
      snippet: 'newer replica summary',
      topicId: 'kw-chat',
      topicTitle: 'Weekly planning',
    });
  });

  it('retains groupId so a group-chat hit keeps its route', async () => {
    await serverDB.insert(chatGroups).values([{ id: 'kw-group', title: 'Squad', userId }]);
    const messageModel = await seed([
      {
        content: 'group replica handoff',
        groupId: 'kw-group',
        id: 'kw-group-msg',
        role: 'user',
        userId,
      },
    ]);

    const result = await messageModel.searchByKeyword({ keyword: 'replica' });

    // A group message carries `groupId` rather than `agentId`; the CLI resolves
    // its URL from these two, so the projection has to keep the group ref.
    expect(result.items[0]).toMatchObject({
      agentId: null,
      groupId: 'kw-group',
      id: 'kw-group-msg',
    });
  });

  it('filters by time range, role, topic and agent', async () => {
    const messageModel = await seed([
      {
        agentId: 'kw-agent',
        content: 'goal review in range',
        createdAt: new Date('2026-10-14T00:00:00.000Z'),
        id: 'kw-in',
        role: 'user',
        topicId: 'kw-chat',
        userId,
      },
      {
        content: 'goal review before range',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        id: 'kw-before',
        role: 'user',
        topicId: 'kw-chat',
        userId,
      },
      {
        content: 'goal review reply',
        createdAt: new Date('2026-10-14T01:00:00.000Z'),
        id: 'kw-reply',
        role: 'assistant',
        topicId: 'kw-doc',
        userId,
      },
    ]);

    const range = {
      endDate: new Date('2026-10-18T23:59:59.000Z'),
      keyword: 'goal review',
      startDate: new Date('2026-10-12T00:00:00.000Z'),
    };

    const inRange = await messageModel.searchByKeyword(range);
    expect(inRange.items.map(({ id }) => id)).toEqual(['kw-reply', 'kw-in']);

    const userOnly = await messageModel.searchByKeyword({ ...range, roles: ['user'] });
    expect(userOnly.items.map(({ id }) => id)).toEqual(['kw-in']);

    const byTopic = await messageModel.searchByKeyword({ ...range, topicId: 'kw-doc' });
    expect(byTopic.items.map(({ id }) => id)).toEqual(['kw-reply']);

    const byAgent = await messageModel.searchByKeyword({ ...range, agentId: 'kw-agent' });
    expect(byAgent.items.map(({ id }) => id)).toEqual(['kw-in']);
  });

  it('hides acceptance verifier prompts, which run in trigger-less task topics', async () => {
    const messageModel = await seed([
      {
        content: '## Check to verify checkItemId: x — goal STAMP',
        id: 'kw-verify-prompt',
        role: 'user',
        topicId: 'kw-verify',
        userId,
      },
      {
        content: 'STAMP check passed',
        id: 'kw-verify-reply',
        role: 'assistant',
        topicId: 'kw-verify',
        userId,
      },
      {
        content: 'what is STAMP',
        id: 'kw-legacy-prompt',
        role: 'user',
        topicId: 'kw-legacy',
        userId,
      },
    ]);

    const visible = await messageModel.searchByKeyword({ keyword: 'STAMP' });
    expect(visible.items.map(({ id }) => id).sort()).toEqual([
      'kw-legacy-prompt',
      'kw-verify-reply',
    ]);

    const all = await messageModel.searchByKeyword({
      includeAutomatedPrompts: true,
      keyword: 'STAMP',
    });
    expect(all.items.map(({ id }) => id)).toContain('kw-verify-prompt');
  });

  it('hides system-written prompts of automation topics unless asked', async () => {
    const messageModel = await seed([
      {
        content: '<task> latency report </task>',
        id: 'kw-task-prompt',
        role: 'user',
        topicId: 'kw-task',
        userId,
      },
      {
        content: 'latency report delivered',
        id: 'kw-task-reply',
        role: 'assistant',
        topicId: 'kw-task',
        userId,
      },
      {
        content: 'eval latency report question',
        id: 'kw-eval-prompt',
        role: 'user',
        topicId: 'kw-eval',
        userId,
      },
      {
        content: 'my latency report idea',
        id: 'kw-doc-prompt',
        role: 'user',
        topicId: 'kw-doc',
        userId,
      },
      { content: 'latency report without topic', id: 'kw-no-topic', role: 'user', userId },
    ]);

    const visible = await messageModel.searchByKeyword({ keyword: 'latency report' });
    expect(visible.items.map(({ id }) => id).sort()).toEqual([
      'kw-doc-prompt',
      'kw-no-topic',
      'kw-task-reply',
    ]);

    const all = await messageModel.searchByKeyword({
      includeAutomatedPrompts: true,
      keyword: 'latency report',
    });
    expect(all.items).toHaveLength(5);
  });

  it('matches case-sensitively in exact mode', async () => {
    const messageModel = await seed([
      {
        content: 'Rolling out the STAMP mode',
        id: 'kw-upper',
        role: 'user',
        topicId: 'kw-chat',
        userId,
      },
      {
        content: 'a rare stamp collection',
        id: 'kw-lower',
        role: 'user',
        topicId: 'kw-chat',
        userId,
      },
    ]);

    const loose = await messageModel.searchByKeyword({ keyword: 'STAMP' });
    expect(loose.items.map(({ id }) => id).sort()).toEqual(['kw-lower', 'kw-upper']);

    const exact = await messageModel.searchByKeyword({ exact: true, keyword: 'STAMP' });
    expect(exact.items.map(({ id }) => id)).toEqual(['kw-upper']);
  });

  it('matches whole terms in exact mode, the same on every provider', async () => {
    const messageModel = await seed([
      { content: '打通KESTREL模式', id: 'kw-cjk', role: 'user', topicId: 'kw-chat', userId },
      { content: 'KESTREL.', id: 'kw-punct', role: 'user', topicId: 'kw-chat', userId },
      { content: 'the KESTRELS flew', id: 'kw-plural', role: 'user', topicId: 'kw-chat', userId },
      { content: 'MKESTREL build', id: 'kw-prefixed', role: 'user', topicId: 'kw-chat', userId },
      { content: 'ship C++20 now', id: 'kw-cpp', role: 'user', topicId: 'kw-chat', userId },
    ]);

    const term = await messageModel.searchByKeyword({ exact: true, keyword: 'KESTREL' });
    // A tokenizing provider never retrieves "KESTRELS"/"MKESTREL" for KESTREL; pg_like
    // does, so the PostgreSQL check must drop them for the providers to agree.
    expect(term.items.map(({ id }) => id).sort()).toEqual(['kw-cjk', 'kw-punct']);

    const partial = await messageModel.searchByKeyword({ exact: true, keyword: 'STREL' });
    expect(partial.items).toEqual([]);

    const symbol = await messageModel.searchByKeyword({ exact: true, keyword: 'C++' });
    expect(symbol.items.map(({ id }) => id)).toEqual(['kw-cpp']);
  });

  it('pages with limit and offset', async () => {
    const messageModel = await seed(
      [1, 2, 3].map((n) => ({
        content: `paging keyword ${n}`,
        createdAt: new Date(`2026-10-1${n}T00:00:00.000Z`),
        id: `kw-page-${n}`,
        role: 'user',
        topicId: 'kw-chat',
        userId,
      })),
    );

    const first = await messageModel.searchByKeyword({ keyword: 'paging', limit: 2 });
    expect(first.items.map(({ id }) => id)).toEqual(['kw-page-3', 'kw-page-2']);
    expect(first.hasMore).toBe(true);

    const second = await messageModel.searchByKeyword({ keyword: 'paging', limit: 2, offset: 2 });
    expect(second.items.map(({ id }) => id)).toEqual(['kw-page-1']);
    expect(second.hasMore).toBe(false);
  });

  it('short-circuits an empty candidate pool', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'candidate in chat',
        id: 'kw-cand-chat',
        role: 'user',
        topicId: 'kw-chat',
        userId,
      },
      {
        content: 'candidate task prompt',
        id: 'kw-cand-task',
        role: 'user',
        topicId: 'kw-task',
        userId,
      },
    ]);
    const ftsSearchCandidates = vi
      .fn()
      .mockResolvedValueOnce({
        candidates: [
          { id: 'kw-cand-task', score: 2 },
          { id: 'kw-cand-chat', score: 1 },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({ candidates: [], total: 0 });
    const model = new MessageModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates,
    });

    const result = await model.searchByKeyword({ keyword: 'candidate' });
    expect(result.items.map(({ id }) => id)).toEqual(['kw-cand-chat']);
    expect(result.truncated).toBe(false);
    expect(ftsSearchCandidates).toHaveBeenCalledWith({
      entity: 'messages',
      filters: {},
      pagination: { limit: MESSAGE_KEYWORD_SEARCH_CANDIDATE_POOL },
      query: { fields: ['content'], text: 'candidate' },
    });

    const empty = await model.searchByKeyword({ keyword: 'nothing' });
    expect(empty).toEqual({ hasMore: false, items: [], truncated: false });
  });

  it('bounds the candidate pool, pushes the window into it and reports truncation', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'bounded pool hit',
        id: 'kw-pool-hit',
        role: 'user',
        topicId: 'kw-chat',
        userId,
      },
    ]);
    const ftsSearchCandidates = vi.fn().mockResolvedValue({
      candidates: [{ id: 'kw-pool-hit', score: 1 }],
      total: 5000,
    });
    const model = new MessageModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates,
    });
    const startDate = new Date('2026-10-12T00:00:00.000Z');

    const result = await model.searchByKeyword({ keyword: 'bounded', startDate });

    expect(ftsSearchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { timeRange: { end: undefined, field: 'createdAt', start: startDate } },
        pagination: { limit: MESSAGE_KEYWORD_SEARCH_CANDIDATE_POOL },
      }),
    );
    // The provider matched 5000 rows but returned one: lower-ranked matches were dropped.
    expect(result.truncated).toBe(true);
  });

  it('does not report truncation for a complete pool larger than the nominal size', async () => {
    // Providers over-fetch past the requested pool, so 1,500 of 1,500 is complete.
    const candidates = Array.from({ length: 1500 }, (_, i) => ({ id: `kw-full-${i}`, score: 1 }));
    const model = new MessageModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates: vi.fn().mockResolvedValue({ candidates, total: candidates.length }),
    });

    const result = await model.searchByKeyword({ keyword: 'complete' });

    expect(candidates.length).toBeGreaterThan(MESSAGE_KEYWORD_SEARCH_CANDIDATE_POOL);
    expect(result.truncated).toBe(false);
  });

  it('narrows candidate retrieval to the requested roles, topic and agent', async () => {
    const ftsSearchCandidates = vi.fn().mockResolvedValue({ candidates: [], total: 0 });
    const model = new MessageModel(serverDB, userId, undefined, {
      ftsSearchCandidateEnabled: true,
      ftsSearchCandidates,
    });

    await model.searchByKeyword({
      agentId: 'kw-agent',
      keyword: 'scoped',
      roles: ['user'],
      topicId: 'kw-chat',
    });

    expect(ftsSearchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: {
          messageScope: { roles: ['user'], topicId: 'kw-chat' },
          topicScope: { agentId: 'kw-agent' },
        },
      }),
    );
  });
});

// BM25 retrieval requires the pg_search extension (ParadeDB), not available in PGlite.
describe.skipIf(process.env.TEST_SERVER_DB !== '1')('MessageModel.searchByKeyword (BM25)', () => {
  it('retrieves through pg_search when no candidate provider is enabled', async () => {
    await serverDB.insert(messages).values([
      { content: 'apple pie recipe', id: 'kw-bm25-hit', role: 'user', topicId: 'kw-chat', userId },
      { content: 'banana bread', id: 'kw-bm25-miss', role: 'user', topicId: 'kw-chat', userId },
    ]);

    const result = await new MessageModel(serverDB, userId).searchByKeyword({ keyword: 'apple' });

    expect(result.items.map(({ id }) => id)).toEqual(['kw-bm25-hit']);
  });
});

describe('buildMessageSnippet', () => {
  it('centers on the first match and marks truncation', () => {
    const content = `${'a'.repeat(200)} needle ${'b'.repeat(300)}`;
    const snippet = buildMessageSnippet(content, 'needle');

    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    // The match sits near the front so a truncated table column still shows it.
    expect(snippet.indexOf('needle')).toBeLessThan(30);
  });

  it('falls back to a query term and then to the head of the text', () => {
    expect(buildMessageSnippet('alpha beta', 'missing beta')).toBe('alpha beta');
    expect(buildMessageSnippet('line one\n\nline two', 'zzz')).toBe('line one line two');
  });
});
