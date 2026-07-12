import type {
  DocumentWorkSummaryItem,
  DocumentWorkVersionEventItem,
  DocumentWorkVersionSnapshot,
  RegisterDocumentWorkParams,
  WorkItem,
  WorkVersionItem,
  WorkVersionSnapshot,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';

import { agentDocuments } from '../../schemas/agentDocuments';
import { type DocumentItem, documents } from '../../schemas/file';
import { works } from '../../schemas/work';
import { agentDocumentOwnership, documentOwnership, type WorkContext } from './context';
import { getTotalCostByWorkIds } from './cost';
import {
  listSnapshotVersionEventRows,
  listSnapshotWorkSummaryRows,
  type SnapshotWorkSummaryQueryRow,
  truncateSummaryText,
} from './internal';
import { createVersion, findById, resolveWorkUpsertConflict } from './writes';

export const documentSnapshot = (
  doc: DocumentItem,
  params: Pick<RegisterDocumentWorkParams, 'description' | 'url'>,
): WorkVersionSnapshot => {
  const description =
    params.description?.trim() || doc.description?.trim() || truncateSummaryText(doc.content);

  return {
    document: {
      description,
      id: doc.id,
      title: doc.title,
      url: params.url ?? null,
    } satisfies DocumentWorkVersionSnapshot,
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
    resourceIdentifier: doc.filename,
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
      set: {
        resourceIdentifier: doc.filename,
        updatedAt: new Date(),
      },
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
    metadata: params.agentDocumentId ? { agentDocumentId: params.agentDocumentId } : null,
    snapshot: documentSnapshot(doc, params),
  }));

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

export const listDocumentVersionEvents = async (
  ctx: WorkContext,
  filters: SQL[],
  limit = 20,
): Promise<DocumentWorkVersionEventItem[]> => {
  const rows = await listSnapshotVersionEventRows<DocumentWorkVersionSnapshot>(
    ctx,
    'document',
    filters,
    limit,
  );

  return rows.map((row) => ({
    ...row.work,
    document: row.snapshot,
    resourceType: 'document' as const,
    type: 'document' as const,
    version: row.version,
  }));
};

export const listDocumentWorkSummaryRows = (ctx: WorkContext, filters: SQL[], rowLimit: number) =>
  listSnapshotWorkSummaryRows<DocumentWorkVersionSnapshot>(ctx, 'document', filters, rowLimit);

export const toDocumentWorkSummaries = async (
  ctx: WorkContext,
  rows: SnapshotWorkSummaryQueryRow<DocumentWorkVersionSnapshot>[],
): Promise<DocumentWorkSummaryItem[]> => {
  const costByWorkId = await getTotalCostByWorkIds(
    ctx,
    rows.map((row) => row.work.id),
  );

  return rows.map((row) => ({
    ...row.work,
    document: row.snapshot,
    event: row.event,
    resourceType: 'document' as const,
    totalCost: costByWorkId.get(row.work.id) ?? null,
    type: 'document' as const,
    version: row.version,
  }));
};
