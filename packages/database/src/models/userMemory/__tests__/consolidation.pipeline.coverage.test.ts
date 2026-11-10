// @vitest-environment node
import { eq } from 'drizzle-orm';
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
import { listConsolidatedUserIds, UserMemoryConsolidationModel } from '../consolidation';

const userId = 'consolidation-pipeline-user';
const otherUserId = 'consolidation-pipeline-other';
const serverDB: LobeChatDatabase = await getTestDB();

let model: UserMemoryConsolidationModel;

/** A legacy per-topic context: parent row + context row linked through `user_memory_ids`. */
const createLegacy = async (
  title: string,
  day: string,
  {
    metadata = { sourceId: `tpc_${title}` },
    owner = userId,
  }: {
    metadata?: Record<string, unknown>;
    owner?: string;
  } = {},
) => {
  const capturedAt = new Date(`${day}T08:00:00.000Z`);
  const [memory] = await serverDB
    .insert(userMemories)
    .values({
      capturedAt,
      lastAccessedAt: capturedAt,
      memoryLayer: 'context',
      metadata,
      title: title || null,
      userId: owner,
    })
    .returning();
  const [context] = await serverDB
    .insert(userMemoriesContexts)
    .values({
      capturedAt,
      description: title ? `${title} details` : null,
      title: title || null,
      userId: owner,
      userMemoryIds: [memory.id],
    })
    .returning();
  return { context, memory };
};

/** A minimal plan that files `memberIds` into one dossier of the given title. */
const planFor = (
  memberIds: string[],
  overrides: {
    dossierTitle?: string;
    existingContextId?: string;
    existingDossierId?: string;
    now?: string;
  } = {},
) => ({
  dossiers: [
    {
      existingDossierId: overrides.existingDossierId,
      memberIds,
      now: overrides.now ?? 'v1',
      title: overrides.dossierTitle ?? 'Scheduler',
    },
  ],
  existingContextId: overrides.existingContextId,
  nextSteps: [],
  now: overrides.now ?? 'v1',
  openQuestions: [],
  title: 'Task system',
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  model = new UserMemoryConsolidationModel(serverDB, userId);
});

describe('pipeline reads', () => {
  it('lists every consolidated user once and skips dossiers without an owner', async () => {
    const mine = await createLegacy('scheduler backend', '2026-05-01');
    const theirs = await createLegacy('scheduler panel', '2026-05-02', { owner: otherUserId });
    await new UserMemoryConsolidationModel(serverDB, otherUserId).applyContextPlan(
      'run_theirs',
      planFor([theirs.context.id]),
    );
    await model.applyContextPlan('run_mine', planFor([mine.context.id]));

    // A regrouped dossier can lose its owner: it must not show up as a consolidated user.
    await serverDB.insert(userMemoriesDossiers).values({ title: 'orphan', userId: null });

    const ids = await listConsolidatedUserIds(serverDB);
    expect(ids).toEqual(expect.arrayContaining([userId, otherUserId]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads legacy rows by id, reporting a missing source id as null', async () => {
    const withSource = await createLegacy('with source', '2026-05-01');
    const withoutSource = await createLegacy('no source', '2026-05-02', { metadata: {} });

    expect(await model.getLegacyContextsByIds([])).toEqual([]);

    const items = await model.getLegacyContextsByIds([
      withSource.context.id,
      withoutSource.context.id,
    ]);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(withSource.context.id)?.sourceId).toBe('tpc_with source');
    expect(byId.get(withoutSource.context.id)?.sourceId).toBeNull();
  });

  it('answers an empty id list for filed contexts without touching the table', async () => {
    expect(await model.listFiledContextIds('run_any', [])).toEqual([]);
  });

  it('lists recent evidence titles per dossier, capped and skipping evidence without a title', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const b = await createLegacy('scheduler panel', '2026-05-02');
    const untitled = await createLegacy('', '2026-05-03');
    const filed = await model.applyContextPlan(
      'run_titles',
      planFor([a.context.id, b.context.id, untitled.context.id]),
    );

    expect(await model.listDossierEvidenceTitles([])).toEqual({});

    const dossierId = filed.dossierIds[0];
    // The evidence row for an untitled legacy context carries no title, so it is skipped.
    expect(await model.listDossierEvidenceTitles([dossierId], 1)).toEqual({
      [dossierId]: ['scheduler panel'],
    });
    expect(await model.listDossierEvidenceTitles([dossierId])).toEqual({
      [dossierId]: ['scheduler panel', 'scheduler backend'],
    });
  });
});

describe('queue reads', () => {
  it('reports a pending legacy row without a source id as null', async () => {
    await createLegacy('no source', '2026-05-01', { metadata: {} });

    const [pending] = await model.listPendingLegacyContexts();

    expect(pending.sourceId).toBeNull();
  });

  it('has no resumable queue before anything was enqueued', async () => {
    expect(await model.findResumableQueue()).toBeNull();
  });
});

describe('queue writes are no-ops without work', () => {
  it('ignores an empty queue, an empty route map and entries that are no longer legacy', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');

    await expect(model.enqueue('run_empty', [])).resolves.toBeUndefined();
    await expect(model.markRouted('run_empty', {})).resolves.toBeUndefined();

    await model.enqueue('run_mixed', [
      { id: a.context.id, key: 'product/tasks', route: 'evidence' },
      { id: 'memory-missing', key: 'product/tasks', route: 'evidence' },
    ]);
    expect((await model.listQueued('run_mixed')).map((q) => q.id)).toEqual([a.context.id]);
  });
});

describe('applyContextPlan guards', () => {
  it('creates fresh rows when the plan points at a context and dossier that are gone', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');

    const result = await model.applyContextPlan(
      'run_orphan_targets',
      planFor([a.context.id], {
        existingContextId: 'memory-missing-context',
        existingDossierId: 'memory-missing-dossier',
      }),
    );

    expect(result).toMatchObject({
      contextsCreated: 1,
      contextsUpdated: 0,
      dossiersCreated: 1,
      dossiersUpdated: 0,
    });
    const [dossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, result.dossierIds[0]));
    expect(dossier.contextId).toBe(result.contextId);
  });

  it('keeps the newest evidence date when a later chunk carries older evidence', async () => {
    const newer = await createLegacy('scheduler backend', '2026-06-01');
    const first = await model.applyContextPlan('run_newer', planFor([newer.context.id]));
    const older = await createLegacy('scheduler panel', '2026-05-01');

    await model.applyContextPlan(
      'run_older',
      planFor([older.context.id], {
        existingContextId: first.contextId!,
        existingDossierId: first.dossierIds[0],
        now: 'v2',
      }),
    );

    const [ctx] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, first.contextId!));
    expect(ctx.lastEvidenceAt?.toISOString()).toBe('2026-06-01T08:00:00.000Z');

    const [dossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, first.dossierIds[0]));
    expect(dossier.lastEvidenceAt?.toISOString()).toBe('2026-06-01T08:00:00.000Z');
  });

  it('stores a fresh embedding on an existing context', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const first = await model.applyContextPlan('run_vector_1', planFor([a.context.id]));
    const b = await createLegacy('scheduler panel', '2026-05-02');

    await model.applyContextPlan('run_vector_2', {
      ...planFor([b.context.id], {
        existingContextId: first.contextId!,
        existingDossierId: first.dossierIds[0],
        now: 'v2',
      }),
      descriptionVector: Array.from({ length: 1024 }, () => 0.02),
    });

    const [ctx] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, first.contextId!));
    expect(ctx.descriptionVector).toHaveLength(1024);
  });

  it('extends a synthesized context and dossier that have no parent memory', async () => {
    const capturedAt = new Date('2026-04-01T08:00:00.000Z');
    const [orphanMemory] = await serverDB
      .insert(userMemories)
      .values({
        capturedAt,
        lastAccessedAt: capturedAt,
        memoryLayer: 'context',
        title: 'orphan parent',
        userId,
      })
      .returning();
    // Rows the regroup placed before parents existed: both carry no owning memory.
    const [context] = await serverDB
      .insert(userMemoriesContexts)
      .values({
        capturedAt,
        description: 'v1',
        lastEvidenceAt: capturedAt,
        now: 'v1',
        synthesizedAt: capturedAt,
        title: 'Task system',
        userId,
        userMemoryIds: [orphanMemory.id],
      })
      .returning();
    const [dossier] = await serverDB
      .insert(userMemoriesDossiers)
      .values({
        activityCount: 0,
        contextId: context.id,
        firstSeenAt: capturedAt,
        lastEvidenceAt: capturedAt,
        now: 'v1',
        status: 'active',
        summary: 'v1',
        title: 'Scheduler',
        userId,
      })
      .returning();

    const a = await createLegacy('scheduler backend', '2026-05-01');
    const b = await createLegacy('scheduler panel', '2026-05-02');

    const result = await model.applyContextPlan('run_no_parents', {
      dossiers: [
        {
          existingDossierId: dossier.id,
          memberIds: [a.context.id],
          now: 'group one',
          title: 'Scheduler',
        },
        {
          existingDossierId: dossier.id,
          memberIds: [b.context.id],
          now: 'group two',
          title: 'Scheduler',
        },
      ],
      existingContextId: context.id,
      nextSteps: [],
      now: 'v2',
      openQuestions: [],
      title: 'Task system',
    });

    // Both groups land on the dossier, but only the first logs a before-image.
    expect(result).toMatchObject({
      activities: 2,
      contextsUpdated: 1,
      dossiersUpdated: 1,
    });
    const ops = await serverDB
      .select()
      .from(userMemoriesOperations)
      .where(eq(userMemoriesOperations.userId, userId));
    expect(ops.filter((o) => o.op === 'status')).toHaveLength(2);
  });

  it('carries a member source id onto the evidence only when the legacy row had one', async () => {
    const withSource = await createLegacy('with source', '2026-05-01');
    const withoutSource = await createLegacy('no source', '2026-05-02', { metadata: {} });

    await model.applyContextPlan(
      'run_source_ids',
      planFor([withSource.context.id, withoutSource.context.id]),
    );

    const activities = await serverDB
      .select()
      .from(userMemoriesActivities)
      .where(eq(userMemoriesActivities.userId, userId));
    const byLegacy = new Map(
      activities.map((a) => [(a.metadata as { legacyContextId?: string })?.legacyContextId, a]),
    );
    expect(byLegacy.get(withSource.context.id)?.metadata).toMatchObject({
      sourceId: 'tpc_with source',
    });
    expect(byLegacy.get(withoutSource.context.id)?.metadata).not.toHaveProperty('sourceId');
  });
});

describe('revertRun on before-images a stale run left', () => {
  it('restores a dossier to its defaults and clears the parent summary', async () => {
    const a = await createLegacy('scheduler backend', '2026-05-01');
    const seeded = await model.applyContextPlan('run_seed', planFor([a.context.id]));
    const [ctx] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, seeded.contextId!));
    const [dossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, seeded.dossierIds[0]));

    // An interrupted older run wrote before-images without the parent fields it now records.
    await serverDB.insert(userMemoriesOperations).values([
      {
        actor: 'pipeline',
        before: { parentSummary: null, userMemoryId: ctx.userMemoryId },
        gate: 'auto',
        metadata: { consolidationRunId: 'run_stale' },
        op: 'status',
        state: 'applied',
        targets: { context: ctx.id },
        userId,
      },
      {
        actor: 'pipeline',
        before: null,
        gate: 'auto',
        metadata: { consolidationRunId: 'run_stale' },
        op: 'status',
        state: 'applied',
        targets: { dossier: dossier.id },
        userId,
      },
    ]);

    expect(await model.revertRun('run_stale')).toEqual({ deleted: 0, restored: 0 });

    const [restoredCtx] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, ctx.id));
    expect(restoredCtx).toMatchObject({
      currentStatus: null,
      description: null,
      lastEvidenceAt: null,
      nextSteps: null,
      now: null,
      openQuestions: null,
      synthesizedAt: null,
    });

    const [restoredDossier] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, dossier.id));
    expect(restoredDossier).toMatchObject({
      activityCount: 0,
      lastEvidenceAt: null,
      now: null,
      status: 'active',
      summary: null,
    });

    const [parent] = await serverDB
      .select()
      .from(userMemories)
      .where(eq(userMemories.id, ctx.userMemoryId!));
    expect(parent.summary).toBeNull();
  });

  it('ignores a status operation that names neither a context nor a dossier', async () => {
    // revertRun only reads `op = 'status'` rows, which this pipeline writes with a context
    // or a dossier target. An older or malformed row that names neither must be a no-op.
    await serverDB.insert(userMemoriesOperations).values({
      actor: 'pipeline',
      before: {},
      gate: 'auto',
      metadata: { consolidationRunId: 'run_attached_only' },
      op: 'status',
      state: 'applied',
      targets: { activities: ['activity-missing'] },
      userId,
    });

    expect(await model.revertRun('run_attached_only')).toEqual({ deleted: 0, restored: 0 });
  });
});
