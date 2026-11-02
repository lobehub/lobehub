// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { QuickNoteModel } from '@/database/models/quickNote';
import { QuickNoteRepository } from '@/database/repositories/quickNote';
import { messages, quickNoteRuns, tasks, taskTopics, topics, users } from '@/database/schemas';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';

import { QuickNoteProcessingService } from '.';
import { renderQuickNoteSourceText as renderSourceText } from './sourceText';

// NOTICE:
// Route tests reuse the isolated migration-backed database instead of an application connection.
// The router's serverDatabase middleware otherwise resolves configured infrastructure.
// Source: packages/trpc/src/lambda/middleware/serverDatabase.ts.
// Remove this mock if the router accepts an injected database through its public test context.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => getTestDB() }));
vi.mock('@/server/services/agentSignal', () => ({ enqueueAgentSignalSourceEvent: vi.fn() }));
vi.mock('@/server/services/quickNote/featureGate', () => ({ assertQuickNoteEnabled: vi.fn() }));
// Passthrough by default; context-lookup tests swap in a fake search provider per call.
vi.mock('@/server/services/ftsSearch', async (importOriginal) => {
  const actual = await importOriginal<{ createFtsSearchRepo: (...args: never[]) => unknown }>();
  return { ...actual, createFtsSearchRepo: vi.fn(actual.createFtsSearchRepo) };
});

const db = await getTestDB();
const userId = 'quick-note-lifecycle-test';
const model = new QuickNoteModel(db, userId);
const repo = new QuickNoteRepository(db, userId);
const service = new QuickNoteProcessingService(db, userId);
const { quickNoteRouter } = await import('@/server/routers/lambda/quickNote');
const caller = quickNoteRouter.createCaller({ userId });

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  vi.spyOn(QuickNoteModel, 'isAutomaticAnalyzeEnabled').mockResolvedValue(false);
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  vi.restoreAllMocks();
});

/** @example Declined or undelivered runs release their claim without changing dispatched work. */
describe('Quick Note dispatch lifecycle', () => {
  /** @example Nonempty captures participate in automatic analysis without an additional edit. */
  it('persists the configured automatic deadline on create', async () => {
    const settings = await QuickNoteModel.getAnalyzeSettings(db, userId);
    vi.spyOn(QuickNoteModel, 'getAnalyzeSettings').mockResolvedValue({
      ...settings,
      autoAnalyze: { ...settings.autoAnalyze, enabled: true, idleDelayMs: 6000 },
    });
    const before = Date.now();
    const note = await caller.create({ content: 'captured at Home' });
    /** @example The durable sweep sees the note after its configured quiet period. */
    expect(note.analyzeDueAt?.getTime()).toBeGreaterThanOrEqual(before + 6000);
    const empty = await caller.create({ content: '   ' });
    /** @example Empty captures do not consume analysis. */
    expect(empty.analyzeDueAt).toBeNull();
  });

  /** @example Resource linking finishes before a terminal status becomes observable. */
  it('keeps the run active until related resources are linked', async () => {
    const note = await repo.create({ content: 'source', editorData: { markdown: 'source' } });
    const related = await repo.create({ content: 'related' });
    const run = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });
    let statusWhileLinking: string | undefined;
    const ownedModel = service['model'];
    const linkResource = ownedModel.linkResource;
    vi.spyOn(ownedModel, 'linkResource').mockImplementation(async (...args) => {
      /** @example Clients cannot stop polling before the resource transaction. */
      statusWhileLinking = (await model.getRunContext(run!.id))?.status;
      return linkResource(...args);
    });
    await service.onRunComplete({
      runId: run!.id,
      reason: 'done',
      lastAssistantContent: JSON.stringify({
        summary: 'result',
        tags: [],
        proposals: [],
        relatedResources: [{ type: 'document', id: related.documentId }],
      }),
    });
    /** @example Linking sees an active run, not an already-published terminal result. */
    expect(statusWhileLinking).toBe('pending');
    /** @example Completion is visible only after linking succeeded. */
    expect((await model.getRunContext(run!.id))?.status).toBe('completed');
    /** @example The linked resource records the Run that found it. */
    expect((await model.queryResources(note.id))[0]).toMatchObject({ runId: run!.id });
  });

  /** @example Disabling automatic analysis lets a later manual request create a fresh run. */
  it('terminalizes an automatic claim declined before dispatch', async () => {
    // ROOT CAUSE:
    // Returning run_unavailable left the automatic claim pending and blocked manual retries.
    const note = await repo.create({ content: 'source', editorData: { markdown: 'source' } });
    const run = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'automatic',
    });
    await service.judgeRun(run!.id);
    /** @example The declined claim is terminal. */
    expect(await model.getRunContext(run!.id)).toMatchObject({ status: 'failed' });
    await service.judgeRun(run!.id);
    const retry = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });
    /** @example Duplicate delivery does not revive the old claim. */
    expect(retry).toMatchObject({ status: 'pending', trigger: 'manual' });
    /** @example Manual retry owns a new run ID. */
    expect(retry!.id).not.toBe(run!.id);
  });

  /** @example A transport exception leaves a manual retry possible. */
  it('releases an undispatched claim when enqueue throws', async () => {
    // ROOT CAUSE:
    // The claim committed before enqueue; transport rejection previously stranded it as pending.
    const note = await repo.create({ content: 'source', editorData: { markdown: 'source' } });
    vi.mocked(enqueueAgentSignalSourceEvent).mockRejectedValueOnce(new Error('queue unavailable'));
    /** @example The caller still receives the original enqueue failure. */
    await expect(caller.analyze({ id: note.id, trigger: 'manual' })).rejects.toThrow(
      'queue unavailable',
    );
    const [failed] = await db
      .select()
      .from(quickNoteRuns)
      .where(eq(quickNoteRuns.quickNoteId, note.id));
    /** @example Failure is persisted before the error reaches the caller. */
    expect(failed.status).toBe('failed');
    const retry = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });
    /** @example The active-run uniqueness constraint no longer blocks a fresh claim. */
    expect(retry!.id).not.toBe(failed.id);
  });

  /** @example A delayed enqueue error must not terminalize work that already started. */
  it('preserves a run that starts before enqueue rejects', async () => {
    const note = await repo.create({ content: 'source', editorData: { markdown: 'source' } });
    vi.mocked(enqueueAgentSignalSourceEvent).mockImplementationOnce(async () => {
      await db
        .update(quickNoteRuns)
        .set({ status: 'running' })
        .where(eq(quickNoteRuns.quickNoteId, note.id));
      throw new Error('late transport failure');
    });
    /** @example The transport error remains observable. */
    await expect(caller.analyze({ id: note.id, trigger: 'manual' })).rejects.toThrow(
      'late transport failure',
    );
    const [run] = await db
      .select()
      .from(quickNoteRuns)
      .where(eq(quickNoteRuns.quickNoteId, note.id));
    /** @example Cleanup applies only to pending, undispatched claims. */
    expect(run.status).toBe('running');
  });
  /** @example Turning off automatic analysis does not cancel work already dispatched. */
  it('leaves an already-running automatic run unchanged on duplicate delivery', async () => {
    const note = await repo.create({ content: 'source', editorData: { markdown: 'source' } });
    const run = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'automatic',
    });
    await db.update(quickNoteRuns).set({ status: 'running' }).where(eq(quickNoteRuns.id, run!.id));
    await service.judgeRun(run!.id);
    /** @example A settings change affects future dispatch only. */
    expect(await model.getRunContext(run!.id)).toMatchObject({ status: 'running' });
  });
});

/** @example Context lookup never offers a Quick Note's own Task conversations back as context. */
describe('Quick Note context candidates', () => {
  const seedTaskTopic = async (id: string, context: Record<string, unknown>, seq: number) => {
    await db
      .insert(topics)
      .values({ content: `moshi ${id} notes`, id, title: `moshi ${id}`, userId });
    await db.insert(tasks).values({
      context,
      createdByUserId: userId,
      id: `task-${id}`,
      identifier: `T-${seq}`,
      instruction: 'Compare moshi',
      seq,
    });
    await db.insert(taskTopics).values({ seq: 1, taskId: `task-${id}`, topicId: id, userId });
  };

  beforeEach(async () => {
    await seedTaskTopic('qn-task-topic', { source: { quickNoteId: 'n', type: 'quick_note' } }, 1);
    await seedTaskTopic('plain-task-topic', {}, 2);
  });

  // ROOT CAUSE:
  // Only Quick Note Run Topics were excluded, so the `link` step attached the conversations of
  // Tasks a Quick Note had started (apply / Dive) back onto notes as unrelated context.
  it('excludes conversations of Tasks a Quick Note started', async () => {
    const note = await repo.create({ content: 'moshi', editorData: { markdown: 'moshi' } });
    const run = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });

    const found: { id: string }[] = await service['findContextResources'](
      ['moshi'],
      note.documentId,
    );
    const candidates: { id: string }[] = await service['collectContextCandidates'](
      note.id,
      run!.sourceHistoryId,
    );

    for (const ids of [found.map(({ id }) => id), candidates.map(({ id }) => id)]) {
      expect(ids).toContain('plain-task-topic');
      expect(ids).not.toContain('qn-task-topic');
    }
  });
  // ROOT CAUSE:
  // Context lookup scoped Topics by owner/workspace only. Agent Share visitor Topics keep the
  // creator's ids (told apart by a non-null `senderId`), so a visitor's conversation could be put
  // into the Analyze prompt or linked onto the creator's note.
  it('excludes Agent Share visitor conversations', async () => {
    await db.insert(topics).values({
      content: 'moshi visitor notes',
      id: 'share-visitor-topic',
      senderId: 'share-visitor',
      title: 'moshi visitor',
      userId,
    });
    await db.insert(messages).values({
      content: 'moshi question from a visitor',
      id: 'share-visitor-message',
      role: 'user',
      topicId: 'share-visitor-topic',
      userId,
    });
    const note = await caller.create({
      content: 'moshi',
      editorData: { markdown: 'moshi' },
      resources: [
        { id: 'share-visitor-topic', type: 'topic' },
        { id: 'plain-task-topic', type: 'topic' },
      ],
    });
    const run = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });

    const found: { id: string }[] = await service['findContextResources'](
      ['moshi'],
      note.documentId,
    );
    const candidates: { id: string }[] = await service['collectContextCandidates'](
      note.id,
      run!.sourceHistoryId,
    );
    const linked = (await caller.agenticDetails({ id: note.id })).resources;

    for (const ids of [
      found.map(({ id }) => id),
      candidates.map(({ id }) => id),
      linked.map(({ resourceId }) => resourceId),
    ]) {
      expect(ids).toContain('plain-task-topic');
      expect(ids).not.toContain('share-visitor-topic');
    }
  });

  // ROOT CAUSE:
  // Context lookup loaded every Quick Note Document id and Run/Task Topic id of the scope and
  // bound them into `NOT IN` lists, so each Analyze grew with the scope's history and could pass
  // PostgreSQL's bind-parameter limit.
  it('excludes Quick Note containers without binding their ids', async () => {
    const other = await repo.create({ content: 'zzz', editorData: { markdown: 'zzz' } });
    const otherRun = await repo.claimRun(other.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });
    await db.insert(topics).values({ content: 'zzz', id: 'qn-run-topic', title: 'zzz', userId });
    await db
      .update(quickNoteRuns)
      .set({ topicId: 'qn-run-topic' })
      .where(eq(quickNoteRuns.id, otherRun!.id));
    const note = await repo.create({ content: 'moshi', editorData: { markdown: 'moshi' } });
    const run = await repo.claimRun(note.id, {
      kind: 'analyze',
      renderSourceText,
      trigger: 'manual',
    });

    const client = (db as unknown as { $client: { query: (...args: unknown[]) => unknown } })
      .$client;
    const boundValues: unknown[] = [];
    const query = client.query.bind(client);
    vi.spyOn(client, 'query').mockImplementation((...args: unknown[]) => {
      const [text, values] = args as [unknown, unknown];
      const params = Array.isArray(values)
        ? values
        : (text as { values?: unknown[] } | undefined)?.values;
      boundValues.push(...(params ?? []));
      return query(...args);
    });

    const found: { id: string }[] = await service['findContextResources'](
      ['moshi'],
      note.documentId,
    );
    const candidates: { id: string }[] = await service['collectContextCandidates'](
      note.id,
      run!.sourceHistoryId,
    );
    vi.mocked(client.query).mockRestore();

    /** @example Containers stay excluded. */
    for (const ids of [found.map(({ id }) => id), candidates.map(({ id }) => id)]) {
      expect(ids).not.toContain('qn-task-topic');
      expect(ids).not.toContain('qn-run-topic');
      expect(ids).not.toContain(other.documentId);
    }
    /** @example Unrelated notes' container ids are never sent as query parameters. */
    expect(boundValues).toContain(userId);
    expect(boundValues).not.toContain(other.documentId);
    expect(boundValues).not.toContain('qn-run-topic');
    expect(boundValues).not.toContain('qn-task-topic');
  });
});

/** @example The literal `ILIKE` scan only backs up a missing or thin product-search index. */
describe('Quick Note context lookup fallback', () => {
  const topicIds = ['qn-fts-topic-a', 'qn-fts-topic-b', 'qn-fts-topic-c'];

  beforeEach(async () => {
    await db
      .insert(topics)
      .values(
        topicIds.map((id) => ({ content: 'moshi latency', id, title: `moshi ${id}`, userId })),
      );
  });

  /** Runs the lookup and returns the found ids plus the SQL text of every query it sent. */
  const lookup = async (searchResults: () => Promise<unknown[]>) => {
    vi.mocked(createFtsSearchRepo).mockImplementationOnce(
      async () => ({ search: vi.fn(searchResults) }) as never,
    );
    const note = await repo.create({ content: 'moshi', editorData: { markdown: 'moshi' } });
    const client = (db as unknown as { $client: { query: (...args: unknown[]) => unknown } })
      .$client;
    const statements: string[] = [];
    const query = client.query.bind(client);
    vi.spyOn(client, 'query').mockImplementation((...args: unknown[]) => {
      const [text] = args as [unknown];
      statements.push(typeof text === 'string' ? text : ((text as { text?: string })?.text ?? ''));
      return query(...args);
    });

    const found: { id: string }[] = await service['findContextResources'](
      ['moshi'],
      note.documentId,
    );
    vi.mocked(client.query).mockRestore();

    return {
      ids: found.map(({ id }) => id),
      literalTopicOrMessageScans: statements.filter((statement) =>
        /"(?:topics|messages)"\."(?:title|content)" ilike/i.test(statement),
      ),
    };
  };

  // ROOT CAUSE:
  // The literal `ILIKE '%term%'` scans over Topics and Messages ran on every Analyze alongside the
  // product search, reading the whole scope's history even when the index already answered.
  it('skips the literal Topic and Message scans when search finds enough Topics', async () => {
    const { ids, literalTopicOrMessageScans } = await lookup(async () =>
      topicIds.map((id) => ({ id, title: `moshi ${id}`, type: 'topic' })),
    );

    expect(literalTopicOrMessageScans).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining(topicIds));
  });

  it('falls back to the literal scan when search is unavailable', async () => {
    const { ids, literalTopicOrMessageScans } = await lookup(async () => {
      throw new Error('no search provider');
    });

    expect(literalTopicOrMessageScans.length).toBeGreaterThan(0);
    expect(ids).toEqual(expect.arrayContaining(topicIds));
  });

  it('falls back to the literal scan when search finds too few Topics', async () => {
    const { ids, literalTopicOrMessageScans } = await lookup(async () => []);

    expect(literalTopicOrMessageScans.length).toBeGreaterThan(0);
    expect(ids).toEqual(expect.arrayContaining(topicIds));
  });

  it('limits the literal scan to recently updated Topics', async () => {
    await db
      .update(topics)
      .set({ updatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) })
      .where(eq(topics.id, 'qn-fts-topic-a'));

    const { ids } = await lookup(async () => []);

    expect(ids).not.toContain('qn-fts-topic-a');
    expect(ids).toEqual(expect.arrayContaining(['qn-fts-topic-b', 'qn-fts-topic-c']));
  });
});
