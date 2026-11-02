import { eq, isNotNull, isNull, ne } from 'drizzle-orm';

import { agentDocuments, type DocumentItem, documents } from '../../../schemas';
import { deriveAgentDocumentFields } from '../deriveFields';
import type {
  AgentDocument,
  AgentDocumentListItem,
  AgentDocumentListSourceType,
  AgentDocumentPolicy,
  DocumentLoadFormat,
  PolicyLoad,
} from '../types';
import type { AgentDocumentListQueryRow, AgentDocumentQueryOptions } from './types';

/** Columns of one document-tree row (agent binding joined to its document). */
export const listItemColumns = {
  createdAt: documents.createdAt,
  description: documents.description,
  documentId: agentDocuments.documentId,
  documentUpdatedAt: documents.updatedAt,
  fileId: documents.fileId,
  fileType: documents.fileType,
  filename: documents.filename,
  id: agentDocuments.id,
  parentId: documents.parentId,
  policy: agentDocuments.policy,
  sourceType: documents.sourceType,
  templateId: agentDocuments.templateId,
  title: documents.title,
  updatedAt: agentDocuments.updatedAt,
};

/**
 * Map the list API's source filter onto `documents.source_type`.
 *
 * The list contract has two buckets: `web` (crawled pages) and `file` (everything
 * authored or uploaded as an agent document). Authored docs are stored as
 * `agent` / `agent-signal` / `api`, so `file` means "not web" rather than the
 * literal `file` source type, which only covers uploaded originals.
 */
export const listSourceTypeFilter = (sourceType?: AgentDocumentListSourceType) => {
  if (sourceType === 'web') return [eq(documents.sourceType, 'web')];
  if (sourceType === 'file') return [ne(documents.sourceType, 'web')];
  return [];
};

export function getDocumentStats(content: string) {
  if (!content) return { totalCharCount: 0, totalLineCount: 0 };

  return {
    totalCharCount: content.length,
    totalLineCount: content.split('\n').length,
  };
}

export function getMetadataDescription(
  metadata?: Record<string, unknown> | null,
): string | undefined {
  if (!metadata) return undefined;

  if (typeof metadata.description === 'string') return metadata.description;

  const skill = metadata.skill;
  if (!skill || typeof skill !== 'object') return undefined;

  const frontmatter = (skill as Record<string, unknown>).frontmatter;
  if (!frontmatter || typeof frontmatter !== 'object') return undefined;

  const description = (frontmatter as Record<string, unknown>).description;
  return typeof description === 'string' ? description : undefined;
}

export function toAgentDocument(
  settings: typeof agentDocuments.$inferSelect,
  doc: DocumentItem,
): AgentDocument {
  const policy = (settings.policy as AgentDocumentPolicy | null) ?? null;
  const policyLoadFormat = settings.policyLoadFormat as DocumentLoadFormat;

  return {
    accessPublic: settings.accessPublic,
    accessSelf: settings.accessSelf,
    accessShared: settings.accessShared,
    agentId: settings.agentId,
    policyLoad: settings.policyLoad as PolicyLoad,
    content: doc.content ?? '',
    createdAt: settings.createdAt,
    deleteReason: settings.deleteReason,
    deletedAt: settings.deletedAt,
    deletedByAgentId: settings.deletedByAgentId,
    deletedByUserId: settings.deletedByUserId,
    description: doc.description ?? null,
    documentId: settings.documentId,
    editorData: doc.editorData ?? null,
    fileType: doc.fileType,
    filename: doc.filename ?? '',
    id: settings.id,
    metadata: (doc.metadata as Record<string, any> | null) ?? null,
    parentId: doc.parentId ?? null,
    policy,
    policyLoadFormat,
    policyLoadPosition: settings.policyLoadPosition,
    policyLoadRule: settings.policyLoadRule,
    source: doc.source,
    sourceType: doc.sourceType,
    templateId: settings.templateId ?? null,
    title: doc.title ?? doc.filename ?? '',
    updatedAt: settings.updatedAt,
    userId: settings.userId,
  };
}

export function toAgentDocumentListItem(row: AgentDocumentListQueryRow): AgentDocumentListItem {
  const filename = row.filename ?? '';
  const policy = (row.policy as AgentDocumentPolicy | null) ?? null;
  const item = {
    createdAt: row.createdAt,
    description: row.description ?? null,
    documentId: row.documentId,
    documentUpdatedAt: row.documentUpdatedAt,
    fileId: row.fileId,
    fileType: row.fileType,
    filename,
    id: row.id,
    loadPosition: policy?.context?.position,
    parentId: row.parentId ?? null,
    sourceType: row.sourceType,
    templateId: row.templateId ?? null,
    title: row.title ?? filename,
    updatedAt: row.updatedAt,
  };

  return {
    ...item,
    ...deriveAgentDocumentFields(item),
  };
}

export function buildDeletedAtFilters(options?: AgentDocumentQueryOptions) {
  if (options?.deletedOnly) return [isNotNull(agentDocuments.deletedAt)];
  if (options?.includeDeleted) return [];

  return [isNull(agentDocuments.deletedAt)];
}

export function normalizeListOffset(cursor?: string): number {
  if (!cursor) return 0;

  const parsed = Number.parseInt(cursor, 10);

  // Offset cursors keep the first VFS pagination pass storage-neutral.
  // Callers that need opaque cursors can wrap this model helper at the service layer later.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
