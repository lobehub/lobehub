// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesDossiers,
  userMemoriesOperations,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { deriveContextStatus, UserMemoryConsolidationModel } from '../consolidation';
import { UserMemoryContextModel } from '../context';

const userId = 'consolidation-test-user';
const serverDB: LobeChatDatabase = await getTestDB();

/** A legacy per-topic context: parent row + context row linked through `user_memory_ids`. */
const createLegacy = async (
  title: string,
  day: string,
  { singleParent = false, sourceId = `tpc_${title}` } = {},
) => {
  const capturedAt = new Date(`${day}T08:00:00.000Z`);
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      capturedAt,
      lastAccessedAt: capturedAt,
      memoryLayer: 'context',
      metadata: { sourceId },
      title,
      userId,
    })
    .returning();
  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      capturedAt,
      description: `${title} details`,
      title,
      userId,
      // Current extraction (`createContextMemory`) writes the single parent as well.
      userMemoryId: singleParent ? memory.id : null,
      userMemoryIds: [memory.id],
    })
    .returning();
  return { context, memory };
};

let model: UserMemoryConsolidationModel;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  model = new UserMemoryConsolidationModel(serverDB, userId);
});

describe('UserMemoryConsolidationModel', () => {
  it('lists pending legacy contexts oldest first and reads queued evidence back', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const b = await createLegacy('scheduler panel', '2026-04-01');
    const c = await createLegacy('one-off question', '2026-05-02', { singleParent: true });

    const pending = await model.listPendingLegacyContexts();
    expect(pending.map((p) => p.id)).toEqual([b.context.id, a.context.id, c.context.id]);
    expect(pending[0]).toMatchObject({ memoryId: b.memory.id, sourceId: 'tpc_scheduler panel' });
    // A context written by current extraction (single parent set) is still legacy evidence.
    expect(pending[2]).toMatchObject({ id: c.context.id, memoryId: c.memory.id });

    await model.enqueue('run_1', [
      { id: a.context.id, key: 'product/task', route: 'evidence' },
      { id: b.context.id, key: 'product/task', route: 'evidence' },
      { id: c.context.id, key: 'misc', route: 'drop' },
    ]);
    await model.markRouted('run_1', { [c.context.id]: 'drop' });

    const queued = await model.listQueued('run_1');
    expect(queued.map((q) => [q.id, q.key])).toEqual([
      [b.context.id, 'product/task'],
      [a.context.id, 'product/task'],
    ]);
    // A routed (kept) row is no longer pending.
    expect((await model.listPendingLegacyContexts()).map((p) => p.id)).not.toContain(c.context.id);
  });

  it('files evidence into a new context and dossier, hides the legacy rows, and reverts', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const b = await createLegacy('scheduler panel', '2026-05-03');
    const contextModel = new UserMemoryContextModel(serverDB, userId);
    expect(await contextModel.query()).toHaveLength(2);

    const result = await model.applyContextPlan('run_2', {
      dossiers: [
        {
          memberIds: [a.context.id, b.context.id],
          now: 'Backend and panel shipped',
          title: 'Scheduler',
        },
      ],
      nextSteps: ['Ship cron mode'],
      now: 'Scheduler is live',
      openQuestions: [],
      title: 'Task system',
    });
    expect(result).toMatchObject({ activities: 2, contextsCreated: 1, dossiersCreated: 1 });

    const [dossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.userId, userId));
    expect(dossier).toMatchObject({
      activityCount: 2,
      contextId: result.contextId,
      title: 'Scheduler',
    });
    expect(dossier.lastEvidenceAt?.toISOString()).toBe('2026-05-03T08:00:00.000Z');

    const activities = await serverDB
      .select()
      .from(userMemoriesActivities)
      .where(eq(userMemoriesActivities.userId, userId));
    expect(activities.map((x) => x.dossierId)).toEqual([dossier.id, dossier.id]);
    expect(activities[0].metadata).toMatchObject({
      consolidationRunId: 'run_2',
      legacyContextId: expect.any(String),
    });

    // Readers now see the consolidated context only; the legacy rows are superseded, not deleted.
    const visible = await contextModel.query();
    expect(visible.map((x) => x.title)).toEqual(['Task system']);
    // Readers that join parents through the legacy list still find the new context.
    expect(visible[0].userMemoryIds).toEqual([visible[0].userMemoryId]);
    const [legacyParent] = await serverDB
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, a.memory.id));
    expect(legacyParent.state).toBe('superseded');
    expect(await model.listPendingLegacyContexts()).toHaveLength(0);

    const ops = await serverDB
      .select()
      .from(userMemoriesOperations)
      .where(eq(userMemoriesOperations.userId, userId));
    expect(ops.map((o) => o.op).sort()).toEqual(['attach', 'create', 'create']);

    const reverted = await model.revertRun('run_2');
    expect(reverted.restored).toBe(2);
    expect((await contextModel.query()).map((x) => x.title).sort()).toEqual([
      'scheduler backend',
      'scheduler panel',
    ]);
    expect(
      await serverDB
        .select()
        .from(userMemoriesDossiers)
        .where(eq(userMemoriesDossiers.userId, userId)),
    ).toHaveLength(0);
    expect(await model.listPendingLegacyContexts()).toHaveLength(2);
  });

  it('extends an existing context and dossier in a later run', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const first = await model.applyContextPlan('run_3', {
      dossiers: [{ memberIds: [a.context.id], now: 'v1', title: 'Scheduler' }],
      nextSteps: [],
      now: 'v1',
      openQuestions: [],
      title: 'Task system',
    });
    // Written by current extraction: has a single parent, but is still legacy, not consolidated.
    const b = await createLegacy('scheduler cron mode', '2026-06-01', { singleParent: true });
    const consolidated = await model.listConsolidated();
    expect(consolidated.contexts.map((x) => x.id)).toEqual([first.contextId]);

    const second = await model.applyContextPlan('run_4', {
      dossiers: [
        {
          existingDossierId: first.dossierIds[0],
          memberIds: [b.context.id],
          now: 'v2',
          title: 'Scheduler',
        },
      ],
      existingContextId: first.contextId,
      nextSteps: ['Monitor'],
      now: 'v2',
      openQuestions: [],
      title: 'Task system',
    });
    expect(second).toMatchObject({
      contextId: first.contextId,
      contextsUpdated: 1,
      dossiersUpdated: 1,
    });
    const [dossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.userId, userId));
    expect(dossier).toMatchObject({ activityCount: 2, now: 'v2', summary: 'v2' });

    // Reverting the later run restores the context and dossier it updated in place.
    await model.revertRun('run_4');
    const [restored] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, dossier.id));
    expect(restored).toMatchObject({ activityCount: 1, now: 'v1', summary: 'v1' });
    expect(restored.lastEvidenceAt?.toISOString()).toBe('2026-05-01T08:00:00.000Z');
    const [ctx] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, first.contextId!));
    expect(ctx).toMatchObject({ description: 'v1', now: 'v1' });
    expect(await model.listPendingLegacyContexts()).toHaveLength(1);
  });

  it('reverts a run that updated the same context and dossier in several chunks', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const first = await model.applyContextPlan('run_5', {
      dossiers: [{ memberIds: [a.context.id], now: 'v1', title: 'Scheduler' }],
      nextSteps: [],
      now: 'v1',
      openQuestions: [],
      title: 'Task system',
    });
    const chunk = async (title: string, day: string, version: string) => {
      const legacy = await createLegacy(title, day);
      await model.applyContextPlan('run_6', {
        dossiers: [
          {
            existingDossierId: first.dossierIds[0],
            memberIds: [legacy.context.id],
            now: version,
            title: 'Scheduler',
          },
        ],
        existingContextId: first.contextId,
        nextSteps: [],
        now: version,
        openQuestions: [],
        title: 'Task system',
      });
    };
    await chunk('scheduler cron mode', '2026-06-01', 'v2');
    await chunk('scheduler retries', '2026-06-02', 'v3');

    await model.revertRun('run_6');
    const [dossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, first.dossierIds[0]));
    expect(dossier).toMatchObject({ activityCount: 1, now: 'v1', summary: 'v1' });
    const [ctx] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, first.contextId!));
    expect(ctx).toMatchObject({ description: 'v1', now: 'v1' });
  });

  it('stores the description embedding and keeps it when an update has none', async () => {
    const vector = Array.from({ length: 1024 }, () => 0.01);
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const first = await model.applyContextPlan('run_7', {
      descriptionVector: vector,
      dossiers: [{ memberIds: [a.context.id], now: 'v1', title: 'Scheduler' }],
      nextSteps: [],
      now: 'v1',
      openQuestions: [],
      title: 'Task system',
    });
    const b = await createLegacy('scheduler cron mode', '2026-06-01');
    await model.applyContextPlan('run_8', {
      dossiers: [{ memberIds: [b.context.id], now: 'v2', title: 'Cron' }],
      existingContextId: first.contextId,
      nextSteps: [],
      now: 'v2',
      openQuestions: [],
      title: 'Task system',
    });
    const [ctx] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, first.contextId!));
    expect(ctx.descriptionVector).toHaveLength(1024);
  });

  it('ignores evidence a committed plan already filed when a step is retried', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const plan = {
      dossiers: [{ memberIds: [a.context.id], now: 'v1', title: 'Scheduler' }],
      nextSteps: [],
      now: 'v1',
      openQuestions: [],
      title: 'Task system',
    };
    const first = await model.applyContextPlan('run_9', plan);
    expect(first.activities).toBe(1);
    expect(await model.getLegacyContextsByIds([a.context.id])).toEqual([]);

    const retried = await model.applyContextPlan('run_9', {
      ...plan,
      dossiers: [{ ...plan.dossiers[0], existingDossierId: first.dossierIds[0] }],
      existingContextId: first.contextId,
    });
    expect(retried).toMatchObject({ activities: 0, contextsUpdated: 0, dossiersUpdated: 0 });
    const [dossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, first.dossierIds[0]));
    expect(dossier.activityCount).toBe(1);
  });

  it('keeps parent summaries in step with extended contexts and dossiers', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const first = await model.applyContextPlan('run_10', {
      dossiers: [{ memberIds: [a.context.id], now: 'v1', title: 'Scheduler' }],
      nextSteps: [],
      now: 'v1',
      openQuestions: [],
      title: 'Task system',
    });
    const b = await createLegacy('scheduler cron mode', '2026-06-01');
    await model.applyContextPlan('run_11', {
      dossiers: [
        {
          existingDossierId: first.dossierIds[0],
          memberIds: [b.context.id],
          now: 'dossier v2',
          title: 'Scheduler',
        },
      ],
      existingContextId: first.contextId,
      nextSteps: [],
      now: 'context v2',
      openQuestions: [],
      title: 'Task system',
    });
    const parentSummaries = async () => {
      const [ctx] = await serverDB
        .select()
        .from(userMemoriesContexts)
        .where(eq(userMemoriesContexts.id, first.contextId!));
      const [dossier] = await serverDB
        .select()
        .from(userMemoriesDossiers)
        .where(eq(userMemoriesDossiers.id, first.dossierIds[0]));
      const parents = await serverDB
        .select({ id: userMemories.id, summary: userMemories.summary })
        .from(userMemories)
        .where(inArray(userMemories.id, [ctx.userMemoryId!, dossier.userMemoryId!]));
      const byId = new Map(parents.map((p) => [p.id, p.summary]));
      return [byId.get(ctx.userMemoryId!), byId.get(dossier.userMemoryId!)];
    };
    expect(await parentSummaries()).toEqual(['context v2', 'dossier v2']);

    await model.revertRun('run_11');
    expect(await parentSummaries()).toEqual(['v1', 'v1']);
  });

  it('refuses to revert a run a later run extended, until the later one is reverted', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const first = await model.applyContextPlan('run_12', {
      dossiers: [{ memberIds: [a.context.id], now: 'v1', title: 'Scheduler' }],
      nextSteps: [],
      now: 'v1',
      openQuestions: [],
      title: 'Task system',
    });
    expect(await model.listFiledContextIds('run_12', [a.context.id])).toEqual([first.contextId]);
    const b = await createLegacy('scheduler cron mode', '2026-06-01');
    await model.applyContextPlan('run_13', {
      dossiers: [
        {
          existingDossierId: first.dossierIds[0],
          memberIds: [b.context.id],
          now: 'v2',
          title: 'Scheduler',
        },
      ],
      existingContextId: first.contextId,
      nextSteps: [],
      now: 'v2',
      openQuestions: [],
      title: 'Task system',
    });

    expect(await model.revertRun('run_12')).toEqual({
      blockedBy: ['run_13'],
      deleted: 0,
      restored: 0,
    });
    const contexts = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, first.contextId!));
    expect(contexts).toHaveLength(1);

    await model.revertRun('run_13');
    const reverted = await model.revertRun('run_12');
    expect(reverted.blockedBy).toBeUndefined();
    expect(await model.listPendingLegacyContexts()).toHaveLength(2);
  });

  it('lets a new run adopt the queue a stopped run left, keeping its lineage', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const b = await createLegacy('scheduler cron mode', '2026-06-01');
    await model.enqueue('run_a', [
      { id: a.context.id, key: 'product/tasks', route: 'evidence' },
      { id: b.context.id, key: 'product/tasks', route: 'evidence' },
    ]);
    const filed = await model.applyContextPlan('run_a', {
      dossiers: [{ memberIds: [a.context.id], now: 'v1', title: 'Scheduler' }],
      nextSteps: [],
      now: 'v1',
      openQuestions: [],
      title: 'Task system',
    });
    // run_a stops here: b is still queued.
    expect(await model.findResumableQueue()).toEqual({
      count: 1,
      keys: ['product/tasks'],
      origin: 'run_a',
      runId: 'run_a',
    });

    expect(await model.adoptQueue('run_a', 'run_a', 'run_b')).toBe(1);
    expect((await model.listQueued('run_b')).map((q) => q.id)).toEqual([b.context.id]);
    expect(await model.findResumableQueue()).toMatchObject({ origin: 'run_a', runId: 'run_b' });

    const evidence = await model.listQueueEvidence('run_a');
    expect(evidence).toHaveLength(2);
    expect(evidence).toEqual(
      expect.arrayContaining([
        { contextId: filed.contextId, count: 1, key: 'product/tasks' },
        { contextId: null, count: 1, key: 'product/tasks' },
      ]),
    );
  });
});

describe('deriveContextStatus', () => {
  it('derives status from the newest evidence', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    expect(deriveContextStatus(new Date('2026-10-01T00:00:00Z'), now)).toBe('active');
    expect(deriveContextStatus(new Date('2026-07-01T00:00:00Z'), now)).toBe('dormant');
    expect(deriveContextStatus(new Date('2026-01-01T00:00:00Z'), now)).toBe('closed');
  });
});
