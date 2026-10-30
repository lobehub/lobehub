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
import { deriveContextStatus, UserMemoryConsolidationModel } from '../consolidation';
import { UserMemoryContextModel } from '../context';

const userId = 'consolidation-test-user';
const serverDB: LobeChatDatabase = await getTestDB();

/** A legacy per-topic context: parent row + context row linked through `user_memory_ids`. */
const createLegacy = async (title: string, day: string, sourceId = `tpc_${title}`) => {
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
    const c = await createLegacy('one-off question', '2026-05-02');

    const pending = await model.listPendingLegacyContexts();
    expect(pending.map((p) => p.id)).toEqual([b.context.id, a.context.id, c.context.id]);
    expect(pending[0]).toMatchObject({ memoryId: b.memory.id, sourceId: 'tpc_scheduler panel' });

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
    const b = await createLegacy('scheduler cron mode', '2026-06-01');
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
    expect(dossier).toMatchObject({ activityCount: 2, now: 'v2' });

    // Reverting the later run restores the context and dossier it updated in place.
    await model.revertRun('run_4');
    const [restored] = await serverDB
      .select()
      .from(userMemoriesDossiers)
      .where(eq(userMemoriesDossiers.id, dossier.id));
    expect(restored).toMatchObject({ activityCount: 1, now: 'v1' });
    const [ctx] = await serverDB
      .select()
      .from(userMemoriesContexts)
      .where(eq(userMemoriesContexts.id, first.contextId!));
    expect(ctx.now).toBe('v1');
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
