import type { RegisterDocumentWorkParams, WorkItem, WorkVersionItem } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';

import { agentDocuments } from '../../schemas/agentDocuments';
import { type DocumentItem, documents } from '../../schemas/file';
import { works } from '../../schemas/work';
import { agentDocumentOwnership, documentOwnership, type WorkContext } from './context';
import { createDisplayWorkAdapter } from './displayWork';
import { truncateSummaryText, type WorkDisplayColumns } from './internal';
import { createVersion, findById, resolveWorkUpsertConflict } from './writes';

export const documentDisplayColumns = (
  doc: DocumentItem,
  params: Pick<RegisterDocumentWorkParams, 'description'>,
): WorkDisplayColumns => {
  // Run EVERY description source through the same card-sized truncation helper at
  // write time. Explicit `params.description` and the persisted
  // `documents.description` can each be multi-MB; without truncation that full
  // body would be copied into the card-preview `description` column. Chaining
  // with `||` preserves the original precedence (explicit → persisted → content)
  // because `truncateSummaryText` returns `null` for empty/whitespace input.
  const description =
    truncateSummaryText(params.description) ||
    truncateSummaryText(doc.description) ||
    truncateSummaryText(doc.content);

  return {
    // Layer 3 for documents is opening the document itself; the full text lives
    // in `documents`, so `content` stays NULL here.
    content: null,
    description,
    identifier: doc.filename,
    // No synthesized fallback for a null title: the card falls through to the
    // identifier at the call site so data gaps stay visible.
    title: doc.title,
  };
};

const resolveDocument = async (
  ctx: WorkContext,
  params: Pick<RegisterDocumentWorkParams, 'agentDocumentId' | 'agentId' | 'documentId'>,
): Promise<DocumentItem | null> => {
  const [doc] = await ctx.db
    .select()
    .from(documents)
    .where(and(documentOwnership(ctx), eq(documents.id, params.documentId)))
    .limit(1);

  if (!doc) return null;
  if (!params.agentDocumentId) return doc;

  const filters: SQL[] = [
    agentDocumentOwnership(ctx),
    eq(agentDocuments.id, params.agentDocumentId),
    eq(agentDocuments.documentId, doc.id),
    isNull(agentDocuments.deletedAt),
    ...(params.agentId ? [eq(agentDocuments.agentId, params.agentId)] : []),
  ];

  const [agentDocument] = await ctx.db
    .select({ id: agentDocuments.id })
    .from(agentDocuments)
    .where(and(...filters))
    .limit(1);

  return agentDocument ? doc : null;
};

const upsertDocumentWork = async (ctx: WorkContext, doc: DocumentItem): Promise<WorkItem> => {
  const values = {
    resourceId: doc.id,
    resourceType: 'document' as const,
    type: 'document' as const,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  };

  const conflict = resolveWorkUpsertConflict(ctx);

  const [work] = await ctx.db
    .insert(works)
    .values(values)
    .onConflictDoUpdate({
      ...conflict,
      set: { updatedAt: new Date() },
    })
    .returning();

  return work;
};

const createDocumentVersion = async (
  ctx: WorkContext,
  work: WorkItem,
  doc: DocumentItem,
  params: RegisterDocumentWorkParams,
): Promise<WorkVersionItem> =>
  createVersion(ctx, work, params, () => ({
    display: documentDisplayColumns(doc, params),
    metadata: params.agentDocumentId ? { agentDocumentId: params.agentDocumentId } : null,
  }));

/**
 * Document keeps a custom register (unlike the linear/github factory path):
 * it must resolve + ownership-check the backing `documents` row (and the
 * optional `agentDocuments` binding) before any Work is written, and it stamps
 * the binding into version metadata.
 */
export const registerDocumentWork = async (
  ctx: WorkContext,
  params: RegisterDocumentWorkParams,
): Promise<WorkItem | null> => {
  const doc = await resolveDocument(ctx, params);
  if (!doc) return null;

  const work = await upsertDocumentWork(ctx, doc);
  await createDocumentVersion(ctx, work, doc, params);

  return findById(ctx, work.id);
};

/** Document display columns are card-sized at write time; the adapter reads them straight off `works`. */
export const documentWorkAdapter = createDisplayWorkAdapter({ type: 'document' });
