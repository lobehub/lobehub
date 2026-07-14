import type {
  RegisterExternalWorkParams,
  WorkItem,
  WorkListBaseItem,
  WorkListItem,
  WorkSummaryItem,
  WorkVersionEventItem,
} from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { works, workVersions } from '../../schemas/work';
import { versionOwnership, type WorkContext, workOwnership } from './context';
import {
  currentVersions,
  type DisplayWorkSummaryQueryRow,
  type DisplayWorkType,
  listDisplayVersionEventRows,
  listDisplayWorkSummaryRows,
  type WorkDisplayColumns,
  workListFields,
  type WorkTypeAdapter,
} from './internal';
import { createVersion, findById, resolveWorkUpsertConflict } from './writes';

/**
 * External register pipeline: upsert the Work identity row, then under
 * `createVersion`'s works-row lock update the display columns (patch-only for
 * the fields the tool result carried) and append the version. Patch semantics
 * replace the old snapshot merge at column granularity — a partial tool result
 * (e.g. Linear `{ id, state }`) names only its fields in `patchFields`, so the
 * UPDATE never wipes title/url a concurrent registration just wrote.
 */
export const registerExternalWork = async (
  ctx: WorkContext,
  params: RegisterExternalWorkParams,
): Promise<WorkItem | null> => {
  const conflict = resolveWorkUpsertConflict(ctx);
  const [work] = await ctx.db
    .insert(works)
    .values({
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      sourceThreadId: params.threadId ?? null,
      sourceTopicId: params.topicId ?? null,
      type: 'external',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? null,
    })
    .onConflictDoUpdate({
      ...conflict,
      set: { updatedAt: new Date() },
    })
    .returning();

  const display: WorkDisplayColumns = {
    content: params.content,
    description: params.description,
    identifier: params.identifier,
    status: params.status,
    title: params.title,
    url: params.url,
  };

  await createVersion(ctx, work, params, () => ({ display, patchFields: params.patchFields }));

  return findById(ctx, work.id);
};

/**
 * Build the `WorkTypeAdapter` for a display-backed work type (document /
 * external). The `works` row already carries every display column, so the list
 * item is a card-safe projection of `WorkItem` — the full `content` body stays
 * on the backing row and is excluded from list/summary payloads.
 */
export const createDisplayWorkAdapter = (config: {
  type: DisplayWorkType;
}): WorkTypeAdapter<DisplayWorkSummaryQueryRow> => {
  const toListItem = (work: WorkListBaseItem): WorkListItem => work as WorkListItem;

  return {
    listConversationRows: async (ctx, params) => {
      const rows = await ctx.db
        .select({
          eventCreatedAt: workVersions.createdAt,
          work: workListFields,
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
        item: toListItem(row.work),
      }));
    },

    listSummaryRows: (ctx, filters, rowLimit) =>
      listDisplayWorkSummaryRows(ctx, config.type, filters, rowLimit),

    listVersionEvents: async (ctx, filters, limit) => {
      const rows = await listDisplayVersionEventRows(ctx, config.type, filters, limit);

      return rows.map(
        (row) =>
          ({
            ...toListItem(row.work),
            version: row.version,
          }) as WorkVersionEventItem,
      );
    },

    mapSummaryRow: (row, totalCost) =>
      ({
        ...toListItem(row.work),
        event: row.event,
        totalCost,
        version: row.version,
      }) as WorkSummaryItem,

    mapWorkspaceRow: (row, totalCost) =>
      ({
        ...toListItem(row.work),
        event: row.event,
        totalCost,
        version: row.version,
      }) as WorkSummaryItem,
  };
};
