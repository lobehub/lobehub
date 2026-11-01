import type { DocumentAccessScope } from '@lobechat/types';
import { ordinaryDocumentAccessScope } from '@lobechat/types';

import type { AgentDocumentContext } from '../../models/agentDocuments/agentDocument/context';
import {
  findLiveWithTx,
  insertBackingDocument,
  insertBinding,
  markBindingAsSkillIndex,
  updateBackingDocumentAsSkillIndex,
} from '../../models/agentDocuments/agentDocument/creation';
import {
  buildBackingDocumentUpdate,
  buildBindingSettingsUpdate,
  updateBackingDocument,
  updateBindingSettings,
} from '../../models/agentDocuments/agentDocument/edits';
import {
  deleteBindings,
  deleteUnboundDocuments,
} from '../../models/agentDocuments/agentDocument/lifecycle';
import {
  findByFilename,
  findById,
  findByIdWithOptions,
} from '../../models/agentDocuments/agentDocument/queries';
import { listSubtreeByDocumentId } from '../../models/agentDocuments/agentDocument/tree';
import type {
  AgentDocumentCreateParams,
  AgentDocumentUpdateParams,
  ConvertAgentDocumentToSkillIndexParams,
} from '../../models/agentDocuments/agentDocument/types';
import { buildCopyParams } from '../../models/agentDocuments/copyDocument';
import { buildDocumentFilename } from '../../models/agentDocuments/filename';
import { parseLoadRules } from '../../models/agentDocuments/policy';
import type {
  AgentDocument,
  AgentDocumentPolicy,
  DocumentLoadPosition,
  DocumentLoadRules,
  PolicyLoad,
} from '../../models/agentDocuments/types';
import type { LobeChatDatabase, Transaction } from '../../type';

export interface AgentDocumentUpsertParams {
  createdAt?: Date;
  editorData?: Record<string, any>;
  loadPosition?: DocumentLoadPosition;
  loadRules?: DocumentLoadRules;
  metadata?: Record<string, any>;
  policy?: AgentDocumentPolicy;
  policyLoad?: PolicyLoad;
  templateId?: string;
  updatedAt?: Date;
}

/**
 * Owns agent-document units of work that span the `documents` aggregate and the
 * `agent_documents` binding aggregate.
 *
 * Use when:
 * - Creating, copying, updating or upserting an agent document (document row + binding).
 * - Converting a binding into a managed skill index (document rewrite + binding policy).
 * - Permanently deleting bindings together with the documents they leave unbound.
 *
 * Expects:
 * - The same user, workspace and document-access scope as `AgentDocumentModel`.
 *
 * Returns:
 * - Scoped operations whose writes commit or roll back together.
 *
 * Call stack:
 *
 * AgentDocumentModel.create / copy / update / upsert / permanentlyDelete*
 *   -> AgentDocumentRepository
 *     -> single-table helpers in models/agentDocuments/agentDocument
 */
export class AgentDocumentRepository {
  private readonly ctx: AgentDocumentContext;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    documentAccessScope: DocumentAccessScope = ordinaryDocumentAccessScope,
  ) {
    this.ctx = { db, documentAccessScope, userId, workspaceId };
  }

  /**
   * Creates a document row and links it to an agent in one transaction.
   */
  async create(
    agentId: string,
    filename: string,
    content: string,
    params?: AgentDocumentCreateParams,
  ): Promise<AgentDocument> {
    return this.ctx.db.transaction((trx) =>
      this.createWithTx(trx, agentId, filename, content, params),
    );
  }

  /**
   * Creates a document row and links it to an agent inside a caller-owned transaction.
   *
   * Expects:
   * - `trx` is the active transaction for every write in the caller's unit of work.
   */
  async createWithTx(
    trx: Transaction,
    agentId: string,
    filename: string,
    content: string,
    params?: AgentDocumentCreateParams,
  ): Promise<AgentDocument> {
    const document = await insertBackingDocument(this.ctx, trx, agentId, filename, content, params);

    return insertBinding(this.ctx, trx, agentId, document, params);
  }

  /**
   * Duplicates a live agent document under a new filename for the same agent.
   */
  async copy(documentId: string, newTitle?: string): Promise<AgentDocument | undefined> {
    const existing = await findById(this.ctx, documentId);
    if (!existing) return undefined;

    const title = newTitle?.trim();
    const filename = title
      ? buildDocumentFilename(title)
      : `copy-${Date.now()}-${existing.filename}`;

    // Empty-parse shells must not be duplicated as another shell (the clone
    // reads as Lexical error #38 and blocks cleanup); see `copyDocument.ts`
    // for the shell detection and raw-text downgrade.
    return this.create(
      existing.agentId,
      filename,
      existing.content,
      buildCopyParams(existing, title),
    );
  }

  /**
   * Updates a binding's load policy and, when content fields are given, its
   * backing document in one transaction.
   *
   * Expects:
   * - `documentId` is the agent document binding id; missing bindings are ignored.
   */
  async update(documentId: string, params?: AgentDocumentUpdateParams): Promise<void> {
    const existing = await findById(this.ctx, documentId);

    if (!existing) return;

    const settingsUpdate = buildBindingSettingsUpdate(existing, params);
    const documentUpdate = buildBackingDocumentUpdate(this.ctx, params);

    await this.ctx.db.transaction(async (trx) => {
      if (documentUpdate) {
        await updateBackingDocument(this.ctx, trx, existing.documentId, documentUpdate);
      }

      await updateBindingSettings(this.ctx, trx, documentId, settingsUpdate);
    });
  }

  /**
   * Updates an existing document by filename or creates a new one when missing.
   *
   * Expects:
   * - `filename` addresses the current agent's ordinary filename lookup.
   * - Duplicate filenames are allowed; the first matching filename is the oldest live binding.
   */
  async upsert(
    agentId: string,
    filename: string,
    content: string,
    params?: AgentDocumentUpsertParams,
  ): Promise<AgentDocument> {
    const {
      createdAt,
      editorData,
      loadPosition,
      loadRules,
      metadata,
      policy,
      policyLoad,
      templateId,
      updatedAt,
    } = params ?? {};

    const existing = await findByFilename(this.ctx, agentId, filename);

    if (existing) {
      const currentRules = parseLoadRules(existing);
      const mergedRules = loadRules ? { ...currentRules, ...loadRules } : currentRules;
      const mergedMetadata = metadata
        ? { ...existing.metadata, ...metadata }
        : (existing.metadata ?? undefined);

      await this.update(existing.id, {
        content,
        editorData,
        loadPosition,
        loadRules: mergedRules,
        metadata: mergedMetadata,
        policy,
        policyLoad,
      });

      return (await findByFilename(this.ctx, agentId, filename))!;
    }

    return this.create(agentId, filename, content, {
      createdAt,
      editorData,
      loadPosition,
      loadRules,
      metadata,
      policy,
      policyLoad,
      templateId,
      updatedAt,
    });
  }

  /**
   * Converts an existing ordinary agent document binding into a managed skill index.
   *
   * Returns:
   * - The same agent document binding after document identity and load metadata are updated.
   */
  async convertToSkillIndex(
    params: ConvertAgentDocumentToSkillIndexParams,
  ): Promise<AgentDocument | undefined> {
    return this.ctx.db.transaction((trx) => this.convertToSkillIndexWithTx(trx, params));
  }

  /**
   * Converts a live agent document binding into a managed skill index inside a
   * caller-owned transaction, preserving both `agent_documents.id` and `documents.id`.
   */
  async convertToSkillIndexWithTx(
    trx: Transaction,
    params: ConvertAgentDocumentToSkillIndexParams,
  ): Promise<AgentDocument | undefined> {
    const existing = await findLiveWithTx(this.ctx, trx, params.agentDocumentId);
    if (!existing) return undefined;

    await updateBackingDocumentAsSkillIndex(this.ctx, trx, existing.documentId, params);
    await markBindingAsSkillIndex(this.ctx, trx, params.agentDocumentId);

    return findLiveWithTx(this.ctx, trx, params.agentDocumentId);
  }

  /**
   * Removes a binding and its document when no other agent still owns that document.
   *
   * Returns:
   * - Backing file IDs for reference-safe cleanup by the storage service after commit.
   */
  async permanentlyDelete(documentId: string): Promise<string[]> {
    const existing = await findByIdWithOptions(this.ctx, documentId, { includeDeleted: true });

    if (!existing) return [];

    return this.ctx.db.transaction(async (trx) => {
      await deleteBindings(this.ctx, trx, [documentId]);

      return deleteUnboundDocuments(this.ctx, trx, [existing.documentId]);
    });
  }

  /**
   * Permanently removes a subtree's bindings and documents without deleting shared documents.
   *
   * Returns:
   * - Backing file IDs requiring reference-safe storage cleanup after commit.
   */
  async permanentlyDeleteSubtree(agentId: string, rootDocumentId: string): Promise<string[]> {
    const subtree = await listSubtreeByDocumentId(this.ctx, agentId, rootDocumentId, {
      includeDeleted: true,
    });

    if (subtree.length === 0) return [];

    const agentDocumentIds = subtree.map((item) => item.id);
    const documentIds = subtree.map((item) => item.documentId);

    return this.ctx.db.transaction(async (trx) => {
      await deleteBindings(this.ctx, trx, agentDocumentIds);

      return deleteUnboundDocuments(this.ctx, trx, documentIds);
    });
  }
}
