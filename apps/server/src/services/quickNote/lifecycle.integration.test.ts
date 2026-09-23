// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { QuickNoteModel } from '@/database/models/quickNote';
import { quickNoteRuns, users } from '@/database/schemas';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';

import { QuickNoteProcessingService } from '.';

// NOTICE:
// Route tests reuse the isolated migration-backed database instead of an application connection.
// The router's serverDatabase middleware otherwise resolves configured infrastructure.
// Source: packages/trpc/src/lambda/middleware/serverDatabase.ts.
// Remove this mock if the router accepts an injected database through its public test context.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => getTestDB() }));
vi.mock('@/server/services/agentSignal', () => ({ enqueueAgentSignalSourceEvent: vi.fn() }));
vi.mock('@/server/services/quickNote/featureGate', () => ({ assertQuickNoteEnabled: vi.fn() }));

const db = await getTestDB();
const userId = 'quick-note-lifecycle-test';
const model = new QuickNoteModel(db, userId);
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
    const note = await model.create({ content: 'source', editorData: { markdown: 'source' } });
    const related = await model.create({ content: 'related' });
    const run = await model.claimRun(note.id, { kind: 'analyze', trigger: 'manual' });
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
        annotation: 'result',
        tags: [],
        proposals: [],
        relatedResources: [{ type: 'document', id: related.documentId }],
      }),
    });
    /** @example Linking sees an active run, not an already-published terminal result. */
    expect(statusWhileLinking).toBe('pending');
    /** @example Completion is visible only after linking succeeded. */
    expect((await model.getRunContext(run!.id))?.status).toBe('completed');
  });

  /** @example Disabling automatic analysis lets a later manual request create a fresh run. */
  it('terminalizes an automatic claim declined before dispatch', async () => {
    // ROOT CAUSE:
    // Returning run_unavailable left the automatic claim pending and blocked manual retries.
    const note = await model.create({ content: 'source', editorData: { markdown: 'source' } });
    const run = await model.claimRun(note.id, { kind: 'analyze', trigger: 'automatic' });
    await service.dispatchAnalyzeRun(run!.id);
    /** @example The declined claim is terminal. */
    expect(await model.getRunContext(run!.id)).toMatchObject({ status: 'failed' });
    await service.dispatchAnalyzeRun(run!.id);
    const retry = await model.claimRun(note.id, { kind: 'analyze', trigger: 'manual' });
    /** @example Duplicate delivery does not revive the old claim. */
    expect(retry).toMatchObject({ status: 'pending', trigger: 'manual' });
    /** @example Manual retry owns a new run ID. */
    expect(retry!.id).not.toBe(run!.id);
  });

  /** @example A transport exception leaves a manual retry possible. */
  it('releases an undispatched claim when enqueue throws', async () => {
    // ROOT CAUSE:
    // The claim committed before enqueue; transport rejection previously stranded it as pending.
    const note = await model.create({ content: 'source', editorData: { markdown: 'source' } });
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
    const retry = await model.claimRun(note.id, { kind: 'analyze', trigger: 'manual' });
    /** @example The active-run uniqueness constraint no longer blocks a fresh claim. */
    expect(retry!.id).not.toBe(failed.id);
  });

  /** @example A delayed enqueue error must not terminalize work that already started. */
  it('preserves a run that starts before enqueue rejects', async () => {
    const note = await model.create({ content: 'source', editorData: { markdown: 'source' } });
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
    const note = await model.create({ content: 'source', editorData: { markdown: 'source' } });
    const run = await model.claimRun(note.id, { kind: 'analyze', trigger: 'automatic' });
    await db.update(quickNoteRuns).set({ status: 'running' }).where(eq(quickNoteRuns.id, run!.id));
    await service.dispatchAnalyzeRun(run!.id);
    /** @example A settings change affects future dispatch only. */
    expect(await model.getRunContext(run!.id)).toMatchObject({ status: 'running' });
  });
});
