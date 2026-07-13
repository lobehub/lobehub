import type {
  WorkItem,
  WorkListItem,
  WorkResourceType,
  WorkSummaryItem,
  WorkVersionEventItem,
  WorkVersionSnapshot,
} from '@lobechat/types';
import { and, desc, eq, sql } from 'drizzle-orm';

import { works, workVersions } from '../../schemas/work';
import { versionOwnership, type WorkContext, workOwnership } from './context';
import {
  currentVersions,
  listSnapshotVersionEventRows,
  listSnapshotWorkSummaryRows,
  snapshotField,
  type SnapshotWorkSummaryQueryRow,
  type SnapshotWorkType,
  type WorkTypeAdapter,
  type WorkVersionEventParams,
} from './internal';
import { createVersion, findById, resolveWorkUpsertConflict } from './writes';

/**
 * Read the Work's CURRENT snapshot object (the patch-merge base for partial
 * tool results). Callers run this through the tx-scoped context inside
 * `createVersion`, where the works row is locked — see the factory below.
 */
const findCurrentSnapshot = async <Snapshot>(
  ctx: WorkContext,
  type: SnapshotWorkType,
  workId: string,
): Promise<Snapshot | null> => {
  const [row] = await ctx.db
    .select({
      snapshot: sql<Snapshot>`${workVersions.snapshot}->${sql.raw(`'${type}'`)}`,
    })
    .from(works)
    .innerJoin(workVersions, eq(works.currentVersionId, workVersions.id))
    .where(and(eq(works.id, workId), workOwnership(ctx), eq(works.type, type)))
    .limit(1);

  return row?.snapshot ?? null;
};

/** Resource identity params every snapshot-work registration carries. */
export interface SnapshotWorkRegisterParams extends WorkVersionEventParams {
  resourceId: string;
  resourceType: WorkResourceType;
}

/**
 * Shared register pipeline for snapshot-backed work types whose upsert only
 * needs the resource identity from params (linear / github; `document`
 * resolves and validates its backing rows first, so it keeps a custom
 * register). Upserts the Work identity, then appends a version whose snapshot
 * is patch-merged over the previous one inside `createVersion`'s lock — so a
 * partial tool result (e.g. `{ id, state }`) never wipes fields a concurrent
 * registration just wrote.
 */
export const createSnapshotWorkRegister =
  <Params extends SnapshotWorkRegisterParams, Snapshot>(config: {
    buildSnapshot: (params: Params, previous: Snapshot | null) => WorkVersionSnapshot;
    type: SnapshotWorkType;
  }) =>
  async (ctx: WorkContext, params: Params): Promise<WorkItem | null> => {
    const conflict = resolveWorkUpsertConflict(ctx);
    const [work] = await ctx.db
      .insert(works)
      .values({
        resourceId: params.resourceId,
        resourceType: params.resourceType,
        type: config.type,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? null,
      })
      .onConflictDoUpdate({
        ...conflict,
        set: { updatedAt: new Date() },
      })
      .returning();

    await createVersion(ctx, work, params, async (txCtx) => {
      // Read through the tx-scoped context (see createVersion): the works row is
      // locked, so the patch-merge base is a concurrent winner's committed
      // snapshot, never a stale pre-race one.
      const previous = await findCurrentSnapshot<Snapshot>(txCtx, config.type, work.id);
      return { snapshot: config.buildSnapshot(params, previous) };
    });

    return findById(ctx, work.id);
  };

/**
 * Build the `WorkTypeAdapter` for a snapshot-backed work type. All query
 * shapes are shared (see internal.ts); the per-type difference reduces to the
 * snapshot key. Snapshots are card-sized at WRITE time (free text truncated by
 * the normalizers), so no read-side slimming exists.
 */
export const createSnapshotWorkAdapter = <Snapshot>(config: {
  type: SnapshotWorkType;
}): WorkTypeAdapter<SnapshotWorkSummaryQueryRow<Snapshot>> => {
  // The `[type]: snapshot` computed key + `resourceType` widening defeat the
  // tagged-union inference, so the cast lives here, once, instead of in every
  // per-type module.
  const toListItem = (work: WorkItem, snapshot: Snapshot): WorkListItem =>
    ({
      ...work,
      [config.type]: snapshot,
      resourceType: work.resourceType,
      type: config.type,
    }) as WorkListItem;

  return {
    listConversationRows: async (ctx, params) => {
      const rows = await ctx.db
        .select({
          eventCreatedAt: workVersions.createdAt,
          snapshot: snapshotField<Snapshot>(currentVersions.snapshot, config.type),
          work: works,
        })
        .from(workVersions)
        .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
        .innerJoin(currentVersions, eq(works.currentVersionId, currentVersions.id))
        .where(
          and(
            versionOwnership(ctx),
            eq(workVersions.topicId, params.topicId),
            params.threadFilter,
            eq(works.type, config.type),
          ),
        )
        .orderBy(desc(workVersions.createdAt), desc(works.updatedAt))
        .limit(params.rowLimit);

      return rows.map((row) => ({
        eventCreatedAt: row.eventCreatedAt,
        item: toListItem(row.work, row.snapshot),
      }));
    },

    listSummaryRows: (ctx, filters, rowLimit) =>
      listSnapshotWorkSummaryRows<Snapshot>(ctx, config.type, filters, rowLimit),

    listVersionEvents: async (ctx, filters, limit) => {
      const rows = await listSnapshotVersionEventRows<Snapshot>(ctx, config.type, filters, limit);

      return rows.map(
        (row) =>
          ({
            ...toListItem(row.work, row.snapshot),
            version: row.version,
          }) as WorkVersionEventItem,
      );
    },

    mapSummaryRow: (row, totalCost) =>
      ({
        ...toListItem(row.work, row.snapshot),
        event: row.event,
        totalCost,
        version: row.version,
      }) as WorkSummaryItem,

    mapWorkspaceRow: (row, totalCost) =>
      ({
        ...toListItem(row.work, (row.snapshot as unknown as Record<string, Snapshot>)[config.type]),
        event: row.event,
        totalCost,
        version: row.version,
      }) as WorkSummaryItem,
  };
};
