import { and, asc, desc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';

import { AGENT_SKILL_TEMPLATE_ID, agentDocuments, documents } from '../../../schemas';
import { deriveAgentDocumentFields } from '../deriveFields';
import { parseLoadRules } from '../policy';
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
