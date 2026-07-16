import type { RegisterDocumentWorkParams } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, eq, isNull } from 'drizzle-orm';

import { agentDocuments } from '../../schemas/agentDocuments';
import { type DocumentItem, documents } from '../../schemas/file';
import { agentDocumentOwnership, documentOwnership, type WorkContext } from './context';
import { createDisplayWorkAdapter } from './displayWork';
import { truncateSummaryText, type WorkDisplayColumns } from './internal';
import { registerWorkVersion } from './writes';

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

/**
 * Document keeps a custom register (unlike the linear/github factory path):
 * it must resolve + ownership-check the backing `documents` row (and the
 * optional `agentDocuments` binding) before any Work is written, and it stamps
 * the binding into version metadata.
 */
export const registerDocumentWork = async (
  ctx: WorkContext,
  params: RegisterDocumentWorkParams,
) => {
  const doc = await resolveDocument(ctx, params);
  if (!doc) return null;

  return registerWorkVersion(
    ctx,
    {
      resourceId: doc.id,
      resourceType: 'document',
      type: 'document',
      userId: doc.userId,
      visibility: doc.visibility,
    },
    params,
    () => ({
      display: documentDisplayColumns(doc, params),
      metadata: params.agentDocumentId ? { agentDocumentId: params.agentDocumentId } : null,
    }),
  );
};

/** Document display fields are card-sized before the immutable version snapshot is written. */
export const documentWorkAdapter = createDisplayWorkAdapter({ type: 'document' });
