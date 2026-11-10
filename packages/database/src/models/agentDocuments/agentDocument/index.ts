import type { DocumentAccessScope } from '@lobechat/types';
import { ordinaryDocumentAccessScope } from '@lobechat/types';

import { AgentDocumentRepository } from '../../../repositories/agentDocument';
import type { LobeChatDatabase, Transaction } from '../../../type';
import type {
  AgentDocument,
  AgentDocumentContextRow,
  AgentDocumentListItem,
  AgentDocumentListSourceType,
  AgentDocumentPolicy,
  AgentDocumentWithRules,
  DocumentLoadPosition,
  DocumentLoadRules,
  PolicyLoad,
  ToolUpdateLoadRule,
} from '../types';
import type { AgentDocumentContext } from './context';
import * as creation from './creation';
import * as edits from './edits';
import * as lifecycle from './lifecycle';
import * as loading from './loading';
import * as queries from './queries';
import * as tree from './tree';
import type {
  AgentDocumentCreateParams,
  AgentDocumentQueryOptions,
  AgentDocumentUpdateParams,
  ConvertAgentDocumentToSkillIndexParams,
} from './types';

export * from '../types';

export class AgentDocumentModel {
  /** The scope handed to the helper modules in this directory. */
  private readonly ctx: AgentDocumentContext;
  /**
   * Owns the flows that write both the `documents` row and its `agent_documents`
   * binding; this model forwards to it instead of opening those transactions.
   */
  private readonly repository: AgentDocumentRepository;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    documentAccessScope: DocumentAccessScope = ordinaryDocumentAccessScope,
  ) {
    this.ctx = { db, documentAccessScope, userId, workspaceId };
    this.repository = new AgentDocumentRepository(db, userId, workspaceId, documentAccessScope);
  }

  /**
   * Counts live children per parent `documentId`, for listings that show which
   * entries (folders or documents) have something nested under them. Omit
   * `parentIds` to count every parent of the agent in one grouped query.
   * Parents without children are absent from the map.
   */
  async countChildrenByParentIds(
    agentId: string,
    parentIds?: string[],
  ): Promise<Map<string, number>> {
    return tree.countChildrenByParentIds(this.ctx, agentId, parentIds);
  }

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
  async associate(params: {
    agentId: string;
    documentId: string;
    policyLoad?: PolicyLoad;
  }): Promise<{ id: string }> {
    return creation.associate(this.ctx, params);
  }

  /**
   * Creates a document row and links it to an agent in one transaction
   * (owned by {@link AgentDocumentRepository.create}).
   *
   * Use when:
   * - Creating ordinary agent-visible VFS files or folders.
   * - Creating model-owned documents that still need agent document policy metadata.
   *
   * Expects:
   * - `filename` is a single VFS segment supplied by the caller.
   * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately.
   *
   * Returns:
   * - The created agent document with joined document content and metadata.
   *
   */
  async create(
    agentId: string,
    filename: string,
    content: string,
    params?: AgentDocumentCreateParams,
  ): Promise<AgentDocument> {
    return this.repository.create(agentId, filename, content, params);
  }

  /**
   * Creates a document row and links it to an agent inside a caller-owned transaction.
   *
   * Use when:
   * - A higher-level aggregate must create multiple agent documents atomically.
   * - Callers already run `db.transaction` and need to avoid nested transactions.
   *
   * Expects:
   * - `trx` is the active transaction for every write in the aggregate.
   * - `filename` is a single VFS segment supplied by the caller.
   *
   * Returns:
   * - The created agent document with joined document content and metadata.
   */
  async createWithTx(
    trx: Transaction,
    agentId: string,
    filename: string,
    content: string,
    params?: AgentDocumentCreateParams,
  ): Promise<AgentDocument> {
    return this.repository.createWithTx(trx, agentId, filename, content, params);
  }

  /**
   * Converts an existing ordinary agent document binding into a managed skill index.
   *
   * Use when:
   * - Agent Signal promoted an already-created agent document into skill management.
   * - The caller must preserve both the agent document id and backing document id.
   *
   * Expects:
   * - `agentDocumentId` is a live binding owned by the current user.
   * - `parentId` points to the managed skill bundle document row.
   *
   * Returns:
   * - The same agent document binding after document identity and load metadata are updated.
   *
   */
  async convertAgentDocumentToSkillIndex(
    params: ConvertAgentDocumentToSkillIndexParams,
  ): Promise<AgentDocument | undefined> {
    return this.repository.convertToSkillIndex(params);
  }

  /**
   * Converts a live agent document binding into a managed skill index inside a transaction.
   *
   * Use when:
   * - A higher-level skill aggregate also creates the owning bundle in the same transaction.
   * - The caller must preserve both `agent_documents.id` and `documents.id`.
   *
   * Expects:
   * - `trx` is the active transaction for the whole skill creation operation.
   * - `parentId` points to the managed skill bundle document row inside the same transaction.
   *
   * Returns:
   * - The same agent document binding after document identity and load metadata are updated.
   */
  async convertAgentDocumentToSkillIndexWithTx(
    trx: Transaction,
    params: ConvertAgentDocumentToSkillIndexParams,
  ): Promise<AgentDocument | undefined> {
    return this.repository.convertToSkillIndexWithTx(trx, params);
  }

  /**
   * Writes a repaired editor snapshot only if the backing document still holds
   * the version the repair was computed from.
   *
   * Use when:
   * - A read path rebuilds `editorData` from Markdown and must persist it so the
   *   node ids it exposes stay addressable, without clobbering a concurrent save.
   *
   * Expects:
   * - `expected` is the `content` / `editorData` pair the caller read.
   *
   * Returns:
   * - `true` when the snapshot was written; `false` when the document changed
   *   (or is gone) since it was read, in which case nothing is written.
   */
  async updateEditorSnapshotIfUnchanged(
    documentId: string,
    expected: { content: string; editorData: Record<string, any> | null },
    next: { content: string; editorData: Record<string, any> },
  ): Promise<boolean> {
    return edits.updateEditorSnapshotIfUnchanged(this.ctx, documentId, expected, next);
  }

  async update(documentId: string, params?: AgentDocumentUpdateParams): Promise<void> {
    return this.repository.update(documentId, params);
  }

  /**
   * Updates backing document identity fields without changing ids or load policy.
   *
   * Use when:
   * - Managed skill services need to rename or reparent a document row.
   * - Callers must preserve agent document id and backing document id.
   *
   * Expects:
   * - `agentDocumentId` is the agent document binding id, not the backing document row id.
   * - Omitted fields are left untouched.
   *
   * Returns:
   * - The same agent document binding after identity fields are updated.
   *
   */
  async updateDocumentIdentity(
    agentDocumentId: string,
    params: {
      filename?: string;
      metadata?: Record<string, unknown>;
      parentId?: string | null;
      title?: string;
    },
  ): Promise<AgentDocument | undefined> {
    return edits.updateDocumentIdentity(this.ctx, agentDocumentId, params);
  }

  /**
   * Renames an agent document by updating the backing document filename and title.
   *
   * Use when:
   * - A caller wants title-style rename behavior.
   * - The document should keep its binding, content, policy, and document identity.
   *
   * Expects:
   * - `newTitle` is a human-readable title that can be normalized into a filename.
   * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately.
   *
   * Returns:
   * - The renamed agent document, or `undefined` when the binding is not visible.
   *
   */
  async rename(
    documentId: string,
    newTitle: string,
    options?: { filename?: string },
  ): Promise<AgentDocument | undefined> {
    return edits.rename(this.ctx, documentId, newTitle, options);
  }

  /**
   * Moves or renames an agent document without changing its binding or document identity.
   *
   * Use when:
   * - VFS `rename(from, to)` needs filesystem-style metadata mutation
   * - Callers must preserve document id, agent document id, policy, history, and load settings
   *
   * Expects:
   * - `filename` is already validated as a single VFS path segment
   * - `parentId` points to a document row owned by the same user, or `null` for root
   * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately
   * - `title` defaults to `filename` (path-style rename); id-based moves pass the current title
   *   so relocating a document never rewrites what the user sees
   *
   * Returns:
   * - The same agent document binding after the backing document row is moved
   *
   */
  async movePath(
    documentId: string,
    params: { filename: string; parentId: string | null; title?: string },
  ): Promise<AgentDocument | undefined> {
    return edits.movePath(this.ctx, documentId, params);
  }

  async copy(documentId: string, newTitle?: string): Promise<AgentDocument | undefined> {
    return this.repository.copy(documentId, newTitle);
  }

  async updateToolLoadRule(
    documentId: string,
    rule: ToolUpdateLoadRule,
  ): Promise<AgentDocument | undefined> {
    return edits.updateToolLoadRule(this.ctx, documentId, rule);
  }

  async findById(
    documentId: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    return queries.findById(this.ctx, documentId, options);
  }

  async findByIdWithOptions(
    documentId: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    return queries.findByIdWithOptions(this.ctx, documentId, options);
  }

  /**
   * Updates an existing document by filename or creates a new one when missing.
   *
   * Use when:
   * - Callers want idempotent writes keyed by agent and filename.
   * - Existing document policy and metadata should be merged on update.
   *
   * Expects:
   * - `filename` addresses the current agent's ordinary filename lookup.
   * - Duplicate filenames are allowed; the first matching filename is the oldest live binding.
   *
   * Returns:
   * - The updated or created agent document.
   *
   */
  async upsert(
    agentId: string,
    filename: string,
    content: string,
    params?: {
      createdAt?: Date;
      editorData?: Record<string, any>;
      loadPosition?: DocumentLoadPosition;
      loadRules?: DocumentLoadRules;
      metadata?: Record<string, any>;
      policy?: AgentDocumentPolicy;
      policyLoad?: PolicyLoad;
      templateId?: string;
      updatedAt?: Date;
    },
  ): Promise<AgentDocument> {
    return this.repository.upsert(agentId, filename, content, params);
  }

  async findByAgent(agentId: string): Promise<AgentDocumentWithRules[]> {
    return queries.findByAgent(this.ctx, agentId);
  }

  async listByAgent(
    agentId: string,
    options?: { excludeWeb?: boolean; parentId?: string; sourceType?: AgentDocumentListSourceType },
  ): Promise<AgentDocumentListItem[]> {
    return queries.listByAgent(this.ctx, agentId, options);
  }

  async findSkillDocsByAgent(agentId: string): Promise<AgentDocumentWithRules[]> {
    return queries.findSkillDocsByAgent(this.ctx, agentId);
  }

  async findContextByAgent(agentId: string): Promise<AgentDocumentContextRow[]> {
    return queries.findContextByAgent(this.ctx, agentId);
  }

  async findByDocumentIds(
    agentId: string,
    documentIds: string[],
  ): Promise<AgentDocumentWithRules[]> {
    return queries.findByDocumentIds(this.ctx, agentId, documentIds);
  }

  async listByDocumentIds(
    agentId: string,
    documentIds: string[],
    options?: { sourceType?: AgentDocumentListSourceType },
  ): Promise<AgentDocumentListItem[]> {
    return queries.listByDocumentIds(this.ctx, agentId, documentIds, options);
  }

  async hasByAgent(agentId: string): Promise<boolean> {
    return queries.hasByAgent(this.ctx, agentId);
  }

  async findByTemplate(agentId: string, templateId: string): Promise<AgentDocumentWithRules[]> {
    return queries.findByTemplate(this.ctx, agentId, templateId);
  }

  async findByFilename(
    agentId: string,
    filename: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    return queries.findByFilename(this.ctx, agentId, filename, options);
  }

  async findByParentAndFilename(
    agentId: string,
    parentId: string | null,
    filename: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    return tree.findByParentAndFilename(this.ctx, agentId, parentId, filename, options);
  }

  /**
   * Lists agent document bindings that share one tree segment.
   *
   * Use when:
   * - VFS callers need to choose the visible entry for a path segment
   * - Migration checks need to detect duplicate `parentId + filename` rows
   *
   * Expects:
   * - `parentId` is the canonical document row parent id, not the agent document id
   *
   * Returns:
   * - Matching bindings ordered oldest first so duplicate filename resolution is deterministic
   */
  async listByParentAndFilename(
    agentId: string,
    parentId: string | null,
    filename: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument[]> {
    return tree.listByParentAndFilename(this.ctx, agentId, parentId, filename, options);
  }

  async findByDocumentId(
    agentId: string,
    documentId: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    return queries.findByDocumentId(this.ctx, agentId, documentId, options);
  }

  async listByParent(
    agentId: string,
    parentId: string | null,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument[]> {
    return tree.listByParent(this.ctx, agentId, parentId, options);
  }

  async listDeletedByAgent(agentId: string): Promise<AgentDocument[]> {
    return queries.listDeletedByAgent(this.ctx, agentId);
  }

  async listSubtreeByDocumentId(
    agentId: string,
    rootDocumentId: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument[]> {
    return tree.listSubtreeByDocumentId(this.ctx, agentId, rootDocumentId, options);
  }

  async delete(documentId: string, deleteReason?: string): Promise<void> {
    return lifecycle.deleteDocument(this.ctx, documentId, deleteReason);
  }

  async deleteSubtreeByDocumentId(
    agentId: string,
    rootDocumentId: string,
    deleteReason?: string,
  ): Promise<void> {
    return lifecycle.deleteSubtreeByDocumentId(this.ctx, agentId, rootDocumentId, deleteReason);
  }

  /**
   * Restores a soft-deleted agent document binding to the live tree.
   *
   * Use when:
   * - Moving a deleted document back into active VFS visibility.
   * - Preserving the existing document row and agent document id.
   *
   * Expects:
   * - `documentId` may refer to a deleted binding owned by the current user.
   * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately.
   *
   * Returns:
   * - Nothing; missing bindings are ignored.
   *
   */
  async restore(documentId: string): Promise<void> {
    return lifecycle.restore(this.ctx, documentId);
  }

  async restoreSubtreeByDocumentId(agentId: string, rootDocumentId: string): Promise<void> {
    return lifecycle.restoreSubtreeByDocumentId(this.ctx, agentId, rootDocumentId);
  }

  /**
   * Removes a binding and its document when no other agent still owns that document.
   *
   * Use when:
   * - Permanently deleting an agent trash entry.
   * Expects:
   * - The binding belongs to the current scope.
   * Returns:
   * - Backing file IDs for reference-safe cleanup by the storage service after commit.
   */
  async permanentlyDelete(documentId: string): Promise<string[]> {
    return this.repository.permanentlyDelete(documentId);
  }

  /**
   * Permanently removes a subtree's bindings and documents without deleting shared documents.
   *
   * Use when:
   * - Erasing a complete document subtree in one transaction.
   * Expects:
   * - The root belongs to the requested agent and current scope.
   * Returns:
   * - Backing file IDs requiring reference-safe storage cleanup after commit.
   */
  async permanentlyDeleteSubtreeByDocumentId(
    agentId: string,
    rootDocumentId: string,
  ): Promise<string[]> {
    return this.repository.permanentlyDeleteSubtree(agentId, rootDocumentId);
  }

  async deleteByAgent(agentId: string, deleteReason?: string): Promise<void> {
    return lifecycle.deleteByAgent(this.ctx, agentId, deleteReason);
  }

  async deleteByTemplate(
    agentId: string,
    templateId: string,
    deleteReason?: string,
  ): Promise<void> {
    return lifecycle.deleteByTemplate(this.ctx, agentId, templateId, deleteReason);
  }

  async getDocumentsByPosition(
    agentId: string,
  ): Promise<Map<DocumentLoadPosition, AgentDocumentWithRules[]>> {
    return loading.getDocumentsByPosition(this.ctx, agentId);
  }

  async getLoadableDocuments(
    agentId: string,
    _context?: {
      currentTime?: Date;
      userMessage?: string;
    },
  ): Promise<AgentDocumentWithRules[]> {
    return loading.getLoadableDocuments(this.ctx, agentId, _context);
  }

  async getInjectableDocuments(
    agentId: string,
    context?: {
      currentTime?: Date;
      userMessage?: string;
    },
  ): Promise<AgentDocumentWithRules[]> {
    return loading.getInjectableDocuments(this.ctx, agentId, context);
  }

  async getAgentContext(agentId: string): Promise<string> {
    return loading.getAgentContext(this.ctx, agentId);
  }
}
