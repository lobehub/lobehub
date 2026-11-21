import { AGENT_DOCUMENT_FILE_TYPE, AGENT_DOCUMENT_SOURCE_TYPE } from '@lobechat/const';
import { and, eq, isNull } from 'drizzle-orm';

import {
  agentDocuments,
  type DocumentItem,
  documents,
  type NewAgentDocument,
  type NewDocument,
} from '../../../schemas';
import type { Transaction } from '../../../type';
import { normalizePolicy } from '../policy';
import {
  AgentAccess,
  type AgentDocument,
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  PolicyLoad,
} from '../types';
import {
  agentDocOwnership,
  type AgentDocumentContext,
  documentOwnership,
  scopeMetadata,
} from './context';
import type { AgentDocumentCreateParams, ConvertAgentDocumentToSkillIndexParams } from './types';
import { getDocumentStats, getMetadataDescription, toAgentDocument } from './utils';

/**
 * Associates an existing document row with an agent document binding.
 *
 * Use when:
 * - A document already exists and should become visible to an agent.
 * - Managed mount providers need to bind pre-created document tree nodes.
 *
 * Expects:
 * - `documentId` belongs to the current user.
 * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately.
 *
 * Returns:
 * - The inserted or existing agent document binding id.
 * - An empty id only when the source document is missing.
 *
 */
export async function associate(
  ctx: AgentDocumentContext,
  params: {
    agentId: string;
    documentId: string;
    policyLoad?: PolicyLoad;
  },
): Promise<{ id: string }> {
  const { agentId, documentId, policyLoad } = params;

  // Single-table write: the document row is only read, and the binding insert
  // resolves conflicts itself, so no transaction is needed here.
  const [doc] = await ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), documentOwnership(ctx)))
    .limit(1);

  if (!doc) return { id: '' };

  const [result] = await ctx.db
    .insert(agentDocuments)
    .values({
      accessPublic: 0,
      accessSelf:
        AgentAccess.EXECUTE |
        AgentAccess.LIST |
        AgentAccess.READ |
        AgentAccess.WRITE |
        AgentAccess.DELETE,
      accessShared: 0,
      agentId,
      documentId,
      policyLoad: policyLoad ?? PolicyLoad.PROGRESSIVE,
      policyLoadFormat: DocumentLoadFormat.RAW,
      policyLoadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
      policyLoadRule: DocumentLoadRule.ALWAYS,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: agentDocuments.id });

  if (result) return result;

  // A concurrent caller (or an earlier run) may already own this unique
  // agent/document binding. The conflict loser must resolve that row instead
  // of leaking `undefined` to callers that need the binding id.
  const [existing] = await ctx.db
    .select({ id: agentDocuments.id })
    .from(agentDocuments)
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        eq(agentDocuments.documentId, documentId),
      ),
    )
    .limit(1);

  return { id: existing?.id ?? '' };
}

/**
 * Inserts the backing `documents` row for a new agent document.
 *
 * Use when:
 * - `AgentDocumentRepository` creates an agent document and needs the document
 *   row before it can insert the binding in the same transaction.
 *
 * Expects:
 * - `trx` is the caller-owned transaction; this helper writes only `documents`.
 * - `filename` is a single VFS segment supplied by the caller.
 *
 * Returns:
 * - The inserted document row.
 */
export async function insertBackingDocument(
  ctx: AgentDocumentContext,
  trx: Transaction,
  agentId: string,
  filename: string,
  content: string,
  params?: AgentDocumentCreateParams,
): Promise<DocumentItem> {
  const {
    createdAt,
    editorData,
    fileId,
    fileType = AGENT_DOCUMENT_FILE_TYPE,
    metadata,
    parentId,
    source,
    sourceType = AGENT_DOCUMENT_SOURCE_TYPE,
    title: providedTitle,
    updatedAt,
  } = params ?? {};

  const title = providedTitle?.trim() || filename.replace(/\.[^.]+$/, '');
  const stats = getDocumentStats(content);
  const scopedMetadata = scopeMetadata(ctx, metadata);

  const documentPayload: NewDocument = {
    content,
    createdAt,
    description: getMetadataDescription(scopedMetadata),
    // NOTICE:
    // Agent documents often carry Markdown `content`, but editor history and restore UI
    // depend on this serialized editor snapshot. Service callers that derive content from
    // Markdown should pass a matching `editorData` snapshot instead of relying on content alone.
    // Root cause: `document_histories` snapshots `editor_data`, so missing editor data makes
    // pre-mutation history capture impossible.
    // Removal condition: only if document history supports Markdown-content snapshots.
    editorData,
    fileType,
    filename,
    parentId,
    metadata: scopedMetadata,
    ...(fileId ? { fileId } : {}),
    source: source ?? `agent-document://${agentId}/${encodeURIComponent(filename)}`,
    sourceType,
    title,
    totalCharCount: stats.totalCharCount,
    totalLineCount: stats.totalLineCount,
    updatedAt: updatedAt ?? createdAt,
    userId: ctx.userId,
    // Keep newly created agent resources shared within their existing workspace scope.
    visibility: 'public',
    workspaceId: ctx.workspaceId ?? null,
  };

  const [insertedDocument] = await trx.insert(documents).values(documentPayload).returning();

  return insertedDocument!;
}

/**
 * Inserts the `agent_documents` binding for a freshly inserted backing document.
 *
 * Use when:
 * - `AgentDocumentRepository` links the document row from
 *   {@link insertBackingDocument} to an agent in the same transaction.
 *
 * Expects:
 * - `trx` is the caller-owned transaction; this helper writes only `agent_documents`.
 * - `document` is the backing row returned by {@link insertBackingDocument}.
 *
 * Returns:
 * - The created agent document with joined document content and metadata.
 */
export async function insertBinding(
  ctx: AgentDocumentContext,
  trx: Transaction,
  agentId: string,
  document: DocumentItem,
  params?: AgentDocumentCreateParams,
): Promise<AgentDocument> {
  const { createdAt, loadPosition, loadRules, policy, policyLoad, templateId, updatedAt } =
    params ?? {};
  const normalizedPolicy = normalizePolicy(loadPosition, loadRules, policy);

  const newDoc: NewAgentDocument = {
    accessPublic: 0,
    accessSelf:
      AgentAccess.EXECUTE |
      AgentAccess.LIST |
      AgentAccess.READ |
      AgentAccess.WRITE |
      AgentAccess.DELETE,
    accessShared: 0,
    agentId,
    createdAt,
    policyLoad: policyLoad ?? PolicyLoad.PROGRESSIVE,
    deleteReason: null,
    deletedAt: null,
    deletedByAgentId: null,
    deletedByUserId: null,
    documentId: document.id,
    policy: normalizedPolicy,
    policyLoadFormat: normalizedPolicy.context?.policyLoadFormat || DocumentLoadFormat.RAW,
    policyLoadPosition:
      normalizedPolicy.context?.position || DocumentLoadPosition.BEFORE_FIRST_USER,
    policyLoadRule: normalizedPolicy.context?.rule || DocumentLoadRule.ALWAYS,
    templateId,
    updatedAt: updatedAt ?? createdAt,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  };

  const [settings] = await trx.insert(agentDocuments).values(newDoc).returning();

  return toAgentDocument(settings!, document);
}

/**
 * Reads one live binding joined to its document through a caller-owned transaction.
 *
 * Returns:
 * - The live agent document, or `undefined` when it is missing, deleted, or out of scope.
 */
export async function findLiveWithTx(
  ctx: AgentDocumentContext,
  trx: Transaction,
  agentDocumentId: string,
): Promise<AgentDocument | undefined> {
  const [result] = await trx
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        eq(agentDocuments.id, agentDocumentId),
        agentDocOwnership(ctx),
        isNull(agentDocuments.deletedAt),
      ),
    )
    .limit(1);

  return result ? toAgentDocument(result.settings, result.doc) : undefined;
}

/**
 * Rewrites a backing document row into a managed skill index document.
 *
 * Expects:
 * - `trx` is the caller-owned transaction; this helper writes only `documents`.
 * - `documentId` is the backing row of a live binding resolved in the same transaction.
 */
export async function updateBackingDocumentAsSkillIndex(
  ctx: AgentDocumentContext,
  trx: Transaction,
  documentId: string,
  params: ConvertAgentDocumentToSkillIndexParams,
): Promise<void> {
  const stats = getDocumentStats(params.content);
  const scopedMetadata = scopeMetadata(ctx, params.metadata);

  await trx
    .update(documents)
    .set({
      content: params.content,
      description: getMetadataDescription(scopedMetadata),
      ...(params.editorData !== undefined && { editorData: params.editorData }),
      filename: params.filename,
      fileType: 'skills/index',
      metadata: scopedMetadata,
      parentId: params.parentId,
      source: params.source,
      sourceType: params.sourceType,
      title: params.title,
      totalCharCount: stats.totalCharCount,
      totalLineCount: stats.totalLineCount,
    })
    .where(and(eq(documents.id, documentId), documentOwnership(ctx)));
}

/**
 * Marks a live binding as a managed skill index: stop autoload and tag the template.
 *
 * Expects:
 * - `trx` is the caller-owned transaction; this helper writes only `agent_documents`.
 */
export async function markBindingAsSkillIndex(
  ctx: AgentDocumentContext,
  trx: Transaction,
  agentDocumentId: string,
): Promise<void> {
  await trx
    .update(agentDocuments)
    .set({
      policyLoad: PolicyLoad.DISABLED,
      templateId: 'agent-skill',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentDocuments.id, agentDocumentId),
        agentDocOwnership(ctx),
        isNull(agentDocuments.deletedAt),
      ),
    );
}
