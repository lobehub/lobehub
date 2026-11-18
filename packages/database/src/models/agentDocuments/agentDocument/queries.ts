import { and, asc, desc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';

import {
  AGENT_SKILL_TEMPLATE_ID,
  agentDocuments,
  documents,
  knowledgeBaseFiles,
} from '../../../schemas';
import { isUuid } from '../../../utils/uuid';
import { deriveAgentDocumentFields } from '../deriveFields';
import { canReadDocument, parseLoadRules } from '../policy';
import {
  type AgentDocument,
  type AgentDocumentContextRow,
  type AgentDocumentListItem,
  type AgentDocumentListSourceType,
  type AgentDocumentPolicy,
  type AgentDocumentWithRules,
  type DocumentLoadFormat,
  PolicyLoad,
} from '../types';
import { agentDocOwnership, type AgentDocumentContext, documentOwnership } from './context';
import type { AgentDocumentQueryOptions } from './types';
import {
  buildDeletedAtFilters,
  listItemColumns,
  listSourceTypeFilter,
  toAgentDocument,
  toAgentDocumentListItem,
} from './utils';

export async function findById(
  ctx: AgentDocumentContext,
  documentId: string,
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument | undefined> {
  return findByIdWithOptions(ctx, documentId, options);
}

export async function findByIdWithOptions(
  ctx: AgentDocumentContext,
  documentId: string,
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument | undefined> {
  const [result] = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        eq(agentDocuments.id, documentId),
        agentDocOwnership(ctx),
        ...buildDeletedAtFilters(options),
      ),
    )
    .limit(1);

  if (!result) return undefined;

  return toAgentDocument(result.settings, result.doc);
}

export async function findByAgent(
  ctx: AgentDocumentContext,
  agentId: string,
): Promise<AgentDocumentWithRules[]> {
  const results = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        isNull(agentDocuments.deletedAt),
      ),
    )
    .orderBy(desc(agentDocuments.updatedAt));

  return results.map(({ settings, doc }) => {
    const item = toAgentDocument(settings, doc);
    return {
      ...item,
      ...deriveAgentDocumentFields(item),
      loadRules: parseLoadRules(item),
    };
  });
}

export async function listByAgent(
  ctx: AgentDocumentContext,
  agentId: string,
  options?: { excludeWeb?: boolean; parentId?: string; sourceType?: AgentDocumentListSourceType },
): Promise<AgentDocumentListItem[]> {
  const sourceType = options?.sourceType;
  const parentId = options?.parentId;
  const excludeWeb = options?.excludeWeb;
  const results = await ctx.db
    .select(listItemColumns)
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        isNull(agentDocuments.deletedAt),
        ...listSourceTypeFilter(sourceType),
        ...(excludeWeb ? [ne(documents.sourceType, 'web')] : []),
        ...(parentId ? [eq(documents.parentId, parentId)] : []),
      ),
    )
    .orderBy(desc(agentDocuments.updatedAt));

  return results.map((row) => toAgentDocumentListItem(row));
}

export async function findSkillDocsByAgent(
  ctx: AgentDocumentContext,
  agentId: string,
): Promise<AgentDocumentWithRules[]> {
  const results = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        isNull(agentDocuments.deletedAt),
        or(
          eq(agentDocuments.templateId, AGENT_SKILL_TEMPLATE_ID),
          like(documents.fileType, 'skills/%'),
        ),
      ),
    )
    .orderBy(desc(agentDocuments.updatedAt));

  return results.map(({ settings, doc }) => {
    const item = toAgentDocument(settings, doc);
    return {
      ...item,
      ...deriveAgentDocumentFields(item),
      loadRules: parseLoadRules(item),
    };
  });
}

export async function findContextByAgent(
  ctx: AgentDocumentContext,
  agentId: string,
): Promise<AgentDocumentContextRow[]> {
  const results = await ctx.db
    .select({
      doc: {
        content: sql<string>`
          CASE
            WHEN ${agentDocuments.policyLoad} = ${PolicyLoad.ALWAYS}
              THEN COALESCE(${documents.content}, '')
            ELSE ''
          END
        `.as('content'),
        description: documents.description,
        editorData: sql<Record<string, any> | null>`
          CASE
            WHEN ${agentDocuments.policyLoad} = ${PolicyLoad.ALWAYS} THEN ${documents.editorData}
            ELSE NULL
          END
        `.as('editor_data'),
        filename: documents.filename,
        fileType: documents.fileType,
        parentId: documents.parentId,
        sourceType: documents.sourceType,
        title: documents.title,
        totalCharCount: documents.totalCharCount,
      },
      settings: {
        agentId: agentDocuments.agentId,
        createdAt: agentDocuments.createdAt,
        documentId: agentDocuments.documentId,
        id: agentDocuments.id,
        policy: agentDocuments.policy,
        policyLoad: agentDocuments.policyLoad,
        policyLoadFormat: agentDocuments.policyLoadFormat,
        policyLoadPosition: agentDocuments.policyLoadPosition,
        policyLoadRule: agentDocuments.policyLoadRule,
        templateId: agentDocuments.templateId,
        updatedAt: agentDocuments.updatedAt,
      },
    })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        isNull(agentDocuments.deletedAt),
      ),
    )
    .orderBy(desc(agentDocuments.updatedAt));

  return results.map(({ settings, doc }) => {
    const policy = (settings.policy as AgentDocumentPolicy | null) ?? null;
    const item: Omit<
      AgentDocumentContextRow,
      'category' | 'isFolder' | 'isSkillBundle' | 'isSkillIndex' | 'loadRules'
    > = {
      content: doc.content,
      contentCharCount: doc.totalCharCount,
      createdAt: settings.createdAt,
      description: doc.description ?? null,
      documentId: settings.documentId,
      editorData: doc.editorData ?? null,
      filename: doc.filename ?? '',
      fileType: doc.fileType,
      id: settings.id,
      parentId: doc.parentId ?? null,
      policy,
      policyLoad: settings.policyLoad as PolicyLoad,
      policyLoadFormat: settings.policyLoadFormat as DocumentLoadFormat,
      policyLoadPosition: settings.policyLoadPosition,
      policyLoadRule: settings.policyLoadRule,
      sourceType: doc.sourceType,
      templateId: settings.templateId ?? null,
      title: doc.title ?? doc.filename ?? '',
      updatedAt: settings.updatedAt,
    };
    return {
      ...item,
      ...deriveAgentDocumentFields(item),
      loadRules: parseLoadRules(item),
    };
  });
}

export async function findByDocumentIds(
  ctx: AgentDocumentContext,
  agentId: string,
  documentIds: string[],
): Promise<AgentDocumentWithRules[]> {
  if (documentIds.length === 0) return [];

  const results = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        inArray(agentDocuments.documentId, documentIds),
        isNull(agentDocuments.deletedAt),
      ),
    )
    .orderBy(desc(agentDocuments.updatedAt));

  return results.map(({ settings, doc }) => {
    const item = toAgentDocument(settings, doc);
    return {
      ...item,
      ...deriveAgentDocumentFields(item),
      loadRules: parseLoadRules(item),
    };
  });
}

/**
 * Every binding of `agentId` matching the given references, deleted ones included.
 *
 * Use when:
 * - Deciding whether a historical document read in a conversation still refers to a live
 *   binding, so a deleted or disabled document's old content can be withheld from the model.
 *
 * Expects:
 * - `refs` mixes `documents.id` values (`docs_*`) and `agent_documents.id` UUIDs; any other
 *   value is ignored, so a malformed id never reaches the UUID column.
 *
 * Returns:
 * - The matching rows' identity, soft-delete marker and owner access bitmask.
 */
export async function listBindingStatesByRefs(
  ctx: AgentDocumentContext,
  agentId: string,
  refs: string[],
): Promise<{ accessSelf: number; deletedAt: Date | null; documentId: string; id: string }[]> {
  const bindingIds = [...new Set(refs.filter(isUuid))];
  const documentIds = [...new Set(refs.filter((ref) => !isUuid(ref) && ref.length > 0))];
  if (bindingIds.length === 0 && documentIds.length === 0) return [];

  const matchesRef = or(
    ...(documentIds.length > 0 ? [inArray(agentDocuments.documentId, documentIds)] : []),
    ...(bindingIds.length > 0 ? [inArray(agentDocuments.id, bindingIds)] : []),
  );

  return ctx.db
    .select({
      accessSelf: agentDocuments.accessSelf,
      deletedAt: agentDocuments.deletedAt,
      documentId: agentDocuments.documentId,
      id: agentDocuments.id,
    })
    .from(agentDocuments)
    .where(and(agentDocOwnership(ctx), eq(agentDocuments.agentId, agentId), matchesRef));
}

/**
 * Which of the given backing document ids still have a `documents` row, in any scope.
 *
 * Use when:
 * - Telling a permanently deleted document (row gone, nothing left to tombstone it) apart from
 *   one that exists but is out of the caller's scope, e.g. another owner's knowledge-base page.
 *
 * Returns:
 * - The existing subset of `documentIds`. Only existence is exposed, never content.
 */
export async function listExistingDocumentIds(
  ctx: AgentDocumentContext,
  documentIds: string[],
): Promise<string[]> {
  const ids = [...new Set(documentIds)].filter((id) => id.length > 0 && !isUuid(id));
  if (ids.length === 0) return [];

  const rows = await ctx.db
    .select({ id: documents.id })
    .from(documents)
    .where(inArray(documents.id, ids));
  return rows.map((row) => row.id);
}

/**
 * Which backing documents are knowledge-base items: filed directly under a knowledge base or
 * backed by a file added to one.
 *
 * Use when:
 * - Removing a document from an agent must not revoke the same document where it is still a
 *   live knowledge-base page.
 *
 * Returns:
 * - The subset of `documentIds` that belong to a knowledge base, in one query.
 */
export async function listKnowledgeBaseMemberIds(
  ctx: AgentDocumentContext,
  documentIds: string[],
): Promise<string[]> {
  const ids = [...new Set(documentIds)].filter((id) => id.length > 0 && !isUuid(id));
  if (ids.length === 0) return [];

  const rows = await ctx.db
    .selectDistinct({ id: documents.id })
    .from(documents)
    .leftJoin(knowledgeBaseFiles, eq(documents.fileId, knowledgeBaseFiles.fileId))
    .where(
      and(
        documentOwnership(ctx),
        inArray(documents.id, ids),
        or(isNotNull(documents.knowledgeBaseId), isNotNull(knowledgeBaseFiles.fileId)),
      ),
    );

  return rows.map((row) => row.id);
}

/**
 * Which backing documents were agent documents that no agent may read any more — every
 * binding is soft-deleted or lost read access (disabled) — and that are not knowledge-base
 * items either.
 *
 * Use when:
 * - A generic document read (e.g. the knowledge-base `readKnowledge` tool on `docs_*` ids)
 *   must not resurrect a document the user deleted or disabled on every agent, while
 *   documents that were never agent documents, or that are still knowledge-base pages, stay
 *   readable.
 *
 * Returns:
 * - The matching subset of `documentIds`, resolved with a constant number of queries.
 */
export async function listRevokedFromAllAgents(
  ctx: AgentDocumentContext,
  documentIds: string[],
): Promise<string[]> {
  const ids = [...new Set(documentIds)].filter((id) => id.length > 0 && !isUuid(id));
  if (ids.length === 0) return [];

  const bindings = await ctx.db
    .select({
      accessSelf: agentDocuments.accessSelf,
      deletedAt: agentDocuments.deletedAt,
      documentId: agentDocuments.documentId,
    })
    .from(agentDocuments)
    .where(and(agentDocOwnership(ctx), inArray(agentDocuments.documentId, ids)));

  const live = new Set(
    bindings.filter((row) => !row.deletedAt && canReadDocument(row)).map((row) => row.documentId),
  );
  const candidates = [
    ...new Set(bindings.map((row) => row.documentId).filter((id) => !live.has(id))),
  ];
  if (candidates.length === 0) return [];

  const knowledgeBaseMembers = new Set(await listKnowledgeBaseMemberIds(ctx, candidates));
  return candidates.filter((id) => !knowledgeBaseMembers.has(id));
}

export async function listByDocumentIds(
  ctx: AgentDocumentContext,
  agentId: string,
  documentIds: string[],
  options?: { sourceType?: AgentDocumentListSourceType },
): Promise<AgentDocumentListItem[]> {
  if (documentIds.length === 0) return [];

  const sourceType = options?.sourceType;
  const results = await ctx.db
    .select(listItemColumns)
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        inArray(agentDocuments.documentId, documentIds),
        isNull(agentDocuments.deletedAt),
        ...listSourceTypeFilter(sourceType),
      ),
    )
    .orderBy(desc(agentDocuments.updatedAt));

  return results.map((row) => toAgentDocumentListItem(row));
}

export async function hasByAgent(ctx: AgentDocumentContext, agentId: string): Promise<boolean> {
  const [result] = await ctx.db
    .select({ id: agentDocuments.id })
    .from(agentDocuments)
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        isNull(agentDocuments.deletedAt),
      ),
    )
    .limit(1);

  return !!result;
}

export async function findByTemplate(
  ctx: AgentDocumentContext,
  agentId: string,
  templateId: string,
): Promise<AgentDocumentWithRules[]> {
  const results = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        eq(agentDocuments.templateId, templateId),
        isNull(agentDocuments.deletedAt),
      ),
    )
    .orderBy(desc(agentDocuments.updatedAt));

  return results.map(({ settings, doc }) => {
    const item = toAgentDocument(settings, doc);
    return {
      ...item,
      ...deriveAgentDocumentFields(item),
      loadRules: parseLoadRules(item),
    };
  });
}

export async function findByFilename(
  ctx: AgentDocumentContext,
  agentId: string,
  filename: string,
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument | undefined> {
  const [result] = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        eq(documents.filename, filename),
        ...buildDeletedAtFilters(options),
      ),
    )
    .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id))
    .limit(1);

  if (!result) return undefined;

  return toAgentDocument(result.settings, result.doc);
}

export async function findByDocumentId(
  ctx: AgentDocumentContext,
  agentId: string,
  documentId: string,
  options?: AgentDocumentQueryOptions,
): Promise<AgentDocument | undefined> {
  const [result] = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        eq(agentDocuments.documentId, documentId),
        ...buildDeletedAtFilters(options),
      ),
    )
    .orderBy(desc(agentDocuments.updatedAt))
    .limit(1);

  if (!result) return undefined;

  return toAgentDocument(result.settings, result.doc);
}

export async function listDeletedByAgent(
  ctx: AgentDocumentContext,
  agentId: string,
): Promise<AgentDocument[]> {
  const results = await ctx.db
    .select({ doc: documents, settings: agentDocuments })
    .from(agentDocuments)
    .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
    .where(
      and(
        agentDocOwnership(ctx),
        eq(agentDocuments.agentId, agentId),
        documentOwnership(ctx),
        isNotNull(agentDocuments.deletedAt),
      ),
    )
    .orderBy(desc(agentDocuments.deletedAt), desc(agentDocuments.updatedAt));

  return results.map(({ settings, doc }) => toAgentDocument(settings, doc));
}
