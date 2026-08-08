import type {
  RegisterExternalWorkParams,
  WorkListBaseItem,
  WorkListItem,
  WorkSummaryItem,
  WorkVersionEventItem,
} from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { works, workVersions } from '../../schemas/work';
import { type WorkContext, workOwnership } from './context';
import {
  currentWorkListFields,
  type DisplayWorkType,
  listDisplayVersionEventRows,
  type WorkDisplayColumns,
  type WorkTypeAdapter,
} from './internal';
import { registerWorkVersion } from './writes';

/**
 * External register pipeline: atomically find-or-create the Work, merge partial
 * results with its current snapshot under the Work-row lock, append a complete
 * immutable version, and update the Work's current projection.
 */
export const registerExternalWork = async (
  ctx: WorkContext,
  params: RegisterExternalWorkParams,
) => {
  const display: WorkDisplayColumns = {
    content: params.content,
    description: params.description,
    identifier: params.identifier,
    status: params.status,
    title: params.title,
    url: params.url,
  };

  return registerWorkVersion(
    ctx,
    {
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      type: 'external',
      userId: ctx.userId,
      visibility: 'private',
    },
    params,
    () => ({ display, patchFields: params.patchFields }),
  );
};

/**
 * Build the `WorkTypeAdapter` for a display-backed work type (document /
 * external). Current card fields come from the Work projection; the joined
 * version contributes event metadata only. Full `content` stays excluded from
 * list/summary payloads.
 */
export const createDisplayWorkAdapter = (config: { type: DisplayWorkType }): WorkTypeAdapter => {
  const toListItem = (work: WorkListBaseItem): WorkListItem => work as WorkListItem;

  return {
    listConversationRows: async (ctx, params) => {
      const rows = await ctx.db
        .select({
          eventCreatedAt: workVersions.createdAt,
          work: currentWorkListFields,
        })
        .from(workVersions)
        .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
        .where(
          and(
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

    mapCurrentRow: (row, totalCost) =>
      ({
        ...toListItem(row.work),
        event: row.event,
        totalCost,
        version: row.version,
      }) as WorkSummaryItem,
  };
};
