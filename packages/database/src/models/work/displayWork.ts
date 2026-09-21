import type {
  RegisterExternalWorkParams,
  WorkItem,
  WorkListItem,
  WorkSummaryItem,
  WorkVersionEventItem,
} from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { documents } from '../../schemas/file';
import { works, workVersions } from '../../schemas/work';
import { type WorkContext, workOwnership } from './context';
import {
  currentWorkListFields,
  type DisplayWorkType,
  documentDeletedField,
  documentSummaryJoin,
  listDisplayVersionEventRows,
  resourceNeverDeletedField,
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
  const toListItem = (work: WorkItem, resourceDeleted: boolean): WorkListItem =>
    ({ ...work, resourceDeleted }) as WorkListItem;
  // `document` is the only display-backed type with a local backing row, so it
  // is the only one that LEFT JOINs to derive `resourceDeleted`; the others
  // answer with a constant `false`.
  const isDocument = config.type === 'document';

  return {
    listConversationRows: async (ctx, params) => {
      const query = ctx.db
        .select({
          eventCreatedAt: workVersions.createdAt,
          resourceDeleted: isDocument ? documentDeletedField : resourceNeverDeletedField,
          work: currentWorkListFields,
        })
        .from(workVersions)
        .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
        .$dynamic();

      const rows = await (isDocument ? query.leftJoin(documents, documentSummaryJoin) : query)
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
        item: toListItem(row.work, row.resourceDeleted),
      }));
    },

    listVersionEvents: async (ctx, filters, limit) => {
      const rows = await listDisplayVersionEventRows(ctx, config.type, filters, limit);

      return rows.map(
        (row) =>
          ({
            ...toListItem(row.work, row.resourceDeleted),
            version: row.version,
          }) as WorkVersionEventItem,
      );
    },

    mapCurrentRow: (row, totalCost) =>
      ({
        ...toListItem(row.work, row.resourceDeleted),
        event: row.event,
        totalCost,
        version: row.version,
      }) as WorkSummaryItem,
  };
};
