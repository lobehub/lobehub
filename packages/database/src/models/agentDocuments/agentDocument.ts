import { and, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';

import type { DocumentItem, NewAgentDocument, NewDocument } from '../../schemas';
import { agentDocuments, documents } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildDocumentFilename } from './filename';
import {
  composeToolPolicyUpdate,
  isLoadableDocument,
  normalizePolicy,
  parseLoadRules,
  resolveDocumentLoadPosition,
  sortByLoadRulePriority,
} from './policy';
import type {
  AgentDocument,
  AgentDocumentPolicy,
  AgentDocumentWithRules,
  DocumentLoadRules,
  ToolUpdateLoadRule,
} from './types';
import {
  AgentAccess,
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  PolicyLoad,
} from './types';

export * from './types';

interface AgentDocumentQueryOptions {
  cursor?: string;
  deletedOnly?: boolean;
  includeDeleted?: boolean;
  limit?: number;
}

/**
 * Options for runtime VFS sibling uniqueness checks.
 */
interface AgentDocumentSiblingUniquenessOptions {
  /**
   * Whether to enforce one live ordinary document per `agentId + parentId + filename`.
   *
   * @default true
   *
   * NOTICE:
   * Set this to `false` only for managed mount documents that are not resolved through the
   * ordinary document VFS tree. Managed mounts can reuse backing storage names such as `skills`
   * while exposing distinct mounted namespaces.
   */
  uniqueSibling?: boolean;
}

export class AgentDocumentModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  private getDocumentStats(content: string) {
    if (!content) return { totalCharCount: 0, totalLineCount: 0 };

    return {
      totalCharCount: content.length,
      totalLineCount: content.split('\n').length,
    };
  }

  private toAgentDocument(
    settings: typeof agentDocuments.$inferSelect,
    doc: DocumentItem,
  ): AgentDocument {
    const policy = (settings.policy as AgentDocumentPolicy | null) ?? null;
    const policyLoadFormat =
      (settings.policyLoadFormat as DocumentLoadFormat | null) ??
      policy?.context?.policyLoadFormat ??
      DocumentLoadFormat.RAW;

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
      source: doc.source ?? null,
      sourceType: doc.sourceType,
      templateId: settings.templateId ?? null,
      title: doc.title ?? doc.filename ?? '',
      updatedAt: settings.updatedAt,
      userId: settings.userId,
    };
  }

  private buildDeletedAtFilters(options?: AgentDocumentQueryOptions) {
    if (options?.deletedOnly) return [isNotNull(agentDocuments.deletedAt)];
    if (options?.includeDeleted) return [];

    return [isNull(agentDocuments.deletedAt)];
  }

  /**
   * Guards the agent-visible VFS sibling invariant before writes.
   *
   * Runtime enforcement is required for now because `agentId`/`deletedAt` live on `agent_documents`
   * while `parentId`/`filename` live on `documents`.
   */
  private async assertNoLiveSiblingConflict(
    db: Pick<LobeChatDatabase, 'select'>,
    params: {
      agentId: string;
      excludeAgentDocumentId?: string;
      excludeDocumentId?: string;
      filename: string;
      parentId: string | null;
    },
  ) {
    const excludeAgentDocument = params.excludeAgentDocumentId
      ? ne(agentDocuments.id, params.excludeAgentDocumentId)
      : undefined;
    const excludeDocument = params.excludeDocumentId
      ? ne(agentDocuments.documentId, params.excludeDocumentId)
      : undefined;

    // TODO: Move this extra conflict query to a schema-level invariant when VFS path ownership fields live on one table.
    const [conflict] = await db
      .select({ id: agentDocuments.id })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, params.agentId),
          eq(documents.filename, params.filename),
          params.parentId ? eq(documents.parentId, params.parentId) : isNull(documents.parentId),
          isNull(agentDocuments.deletedAt),
          ...(excludeAgentDocument ? [excludeAgentDocument] : []),
          ...(excludeDocument ? [excludeDocument] : []),
        ),
      )
      .limit(1);

    if (conflict) {
      throw new Error(`Agent document sibling already exists: ${params.filename}`);
    }
  }

  private normalizeListOffset(cursor?: string): number {
    if (!cursor) return 0;

    const parsed = Number.parseInt(cursor, 10);

    // Offset cursors keep the first VFS pagination pass storage-neutral.
    // Callers that need opaque cursors can wrap this model helper at the service layer later.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private async listByParentIds(
    agentId: string,
    parentIds: string[],
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument[]> {
    if (parentIds.length === 0) return [];

    const results = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          inArray(documents.parentId, parentIds),
          ...this.buildDeletedAtFilters(options),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt));

    return results.map(({ settings, doc }) => this.toAgentDocument(settings, doc));
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
   * - `uniqueSibling` defaults to `true` for ordinary VFS documents.
   *
   * Returns:
   * - The inserted agent document binding id, or an empty id when the source document is missing.
   *
   * NOTICE:
   * Pass `uniqueSibling: false` only for managed mount documents whose visible path is resolved by
   * the mount provider instead of the ordinary `parentId + filename` VFS tree.
   */
  async associate(params: {
    agentId: string;
    documentId: string;
    uniqueSibling?: boolean;
    policyLoad?: PolicyLoad;
  }): Promise<{ id: string }> {
    const { agentId, documentId, uniqueSibling = true, policyLoad } = params;

    return this.db.transaction(async (trx) => {
      const [doc] = await trx
        .select()
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.userId, this.userId)))
        .limit(1);

      if (!doc) return { id: '' };

      if (uniqueSibling) {
        await this.assertNoLiveSiblingConflict(trx, {
          agentId,
          excludeDocumentId: documentId,
          filename: doc.filename ?? '',
          parentId: doc.parentId ?? null,
        });
      }

      const [result] = await trx
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
          userId: this.userId,
        })
        .onConflictDoNothing()
        .returning({ id: agentDocuments.id });

      return { id: result?.id };
    });
  }

  /**
   * Creates a document row and links it to an agent in one transaction.
   *
   * Use when:
   * - Creating ordinary agent-visible VFS files or folders.
   * - Creating model-owned documents that still need agent document policy metadata.
   *
   * Expects:
   * - `filename` is a single VFS segment supplied by the caller.
   * - `uniqueSibling` defaults to `true` for ordinary VFS documents.
   *
   * Returns:
   * - The created agent document with joined document content and metadata.
   *
   * NOTICE:
   * Pass `uniqueSibling: false` only for managed mount documents whose storage filename can
   * intentionally collide with ordinary-looking names outside the ordinary VFS resolver.
   */
  async create(
    agentId: string,
    filename: string,
    content: string,
    params?: {
      createdAt?: Date;
      editorData?: Record<string, any>;
      fileType?: string;
      loadPosition?: DocumentLoadPosition;
      loadRules?: DocumentLoadRules;
      metadata?: Record<string, any>;
      parentId?: string | null;
      policy?: AgentDocumentPolicy;
      policyLoad?: PolicyLoad;
      templateId?: string;
      title?: string;
      updatedAt?: Date;
    } & AgentDocumentSiblingUniquenessOptions,
  ): Promise<AgentDocument> {
    const {
      createdAt,
      editorData,
      uniqueSibling = true,
      fileType = 'agent/document',
      loadPosition,
      loadRules,
      metadata,
      parentId,
      policy,
      policyLoad,
      templateId,
      title: providedTitle,
      updatedAt,
    } = params ?? {};

    const title = providedTitle?.trim() || filename.replace(/\.[^.]+$/, '');
    const stats = this.getDocumentStats(content);
    const normalizedPolicy = normalizePolicy(loadPosition, loadRules, policy);

    return this.db.transaction(async (trx) => {
      if (uniqueSibling) {
        await this.assertNoLiveSiblingConflict(trx, {
          agentId,
          filename,
          parentId: parentId ?? null,
        });
      }

      const documentPayload: NewDocument = {
        content,
        createdAt,
        description: metadata?.description,
        editorData,
        fileType,
        filename,
        parentId,
        metadata,
        source: `agent-document://${agentId}/${encodeURIComponent(filename)}`,
        sourceType: 'file',
        title,
        totalCharCount: stats.totalCharCount,
        totalLineCount: stats.totalLineCount,
        updatedAt: updatedAt ?? createdAt,
        userId: this.userId,
      };

      const [insertedDocument] = await trx.insert(documents).values(documentPayload).returning();

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
        documentId: insertedDocument!.id,
        policy: normalizedPolicy,
        policyLoadFormat: normalizedPolicy.context?.policyLoadFormat || DocumentLoadFormat.RAW,
        policyLoadPosition:
          normalizedPolicy.context?.position || DocumentLoadPosition.BEFORE_FIRST_USER,
        policyLoadRule: normalizedPolicy.context?.rule || DocumentLoadRule.ALWAYS,
        templateId,
        updatedAt: updatedAt ?? createdAt,
        userId: this.userId,
      };

      const [settings] = await trx.insert(agentDocuments).values(newDoc).returning();

      return this.toAgentDocument(settings!, insertedDocument!);
    });
  }

  async update(
    documentId: string,
    params?: {
      content?: string;
      editorData?: Record<string, any>;
      loadPosition?: DocumentLoadPosition;
      loadRules?: Partial<DocumentLoadRules>;
      metadata?: Record<string, any>;
      policy?: AgentDocumentPolicy;
      policyLoad?: PolicyLoad;
    },
  ): Promise<void> {
    const { content, editorData, loadPosition, loadRules, metadata, policy, policyLoad } =
      params ?? {};

    const existing = await this.findById(documentId);

    if (!existing) return;

    const existingPolicy = existing.policy || {};
    const existingContext = existingPolicy.context || {};

    const mergedPolicy = normalizePolicy(
      loadPosition ||
        (existingContext.position as DocumentLoadPosition | undefined) ||
        DocumentLoadPosition.BEFORE_FIRST_USER,
      {
        keywordMatchMode: loadRules?.keywordMatchMode ?? existingContext.keywordMatchMode,
        keywords: loadRules?.keywords ?? existingContext.keywords,
        maxTokens: loadRules?.maxTokens ?? existingContext.maxTokens,
        priority: loadRules?.priority ?? existingContext.priority,
        regexp: loadRules?.regexp ?? existingContext.regexp,
        rule: (loadRules?.rule ??
          existingContext.rule ??
          DocumentLoadRule.ALWAYS) as DocumentLoadRule,
        timeRange: loadRules?.timeRange ?? existingContext.timeRange,
      },
      policy ? { ...existingPolicy, ...policy } : existingPolicy,
    );

    const settingsUpdate: Partial<NewAgentDocument> = {
      policy: mergedPolicy,
      policyLoadFormat: mergedPolicy.context?.policyLoadFormat || DocumentLoadFormat.RAW,
      policyLoadPosition: mergedPolicy.context?.position || DocumentLoadPosition.BEFORE_FIRST_USER,
      policyLoadRule: mergedPolicy.context?.rule || DocumentLoadRule.ALWAYS,
      ...(policyLoad !== undefined && { policyLoad }),
    };

    await this.db.transaction(async (trx) => {
      if (content !== undefined || editorData !== undefined || metadata !== undefined) {
        const documentUpdate: Partial<NewDocument> = {};

        if (content !== undefined) {
          const stats = this.getDocumentStats(content);
          documentUpdate.content = content;
          documentUpdate.totalCharCount = stats.totalCharCount;
          documentUpdate.totalLineCount = stats.totalLineCount;
        }

        if (editorData !== undefined) {
          documentUpdate.editorData = editorData;
        }

        if (metadata !== undefined) {
          documentUpdate.metadata = metadata;
          documentUpdate.description = metadata?.description;
        }

        await trx
          .update(documents)
          .set(documentUpdate)
          .where(and(eq(documents.id, existing.documentId), eq(documents.userId, this.userId)));
      }

      await trx
        .update(agentDocuments)
        .set(settingsUpdate)
        .where(and(eq(agentDocuments.id, documentId), eq(agentDocuments.userId, this.userId)));
    });
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
   * - `uniqueSibling` defaults to `true` for ordinary VFS documents.
   *
   * Returns:
   * - The renamed agent document, or `undefined` when the binding is not visible.
   *
   * NOTICE:
   * Pass `uniqueSibling: false` only for managed mount documents whose provider owns collision
   * handling outside the ordinary document VFS tree.
   */
  async rename(
    documentId: string,
    newTitle: string,
    options: AgentDocumentSiblingUniquenessOptions = {},
  ): Promise<AgentDocument | undefined> {
    const existing = await this.findById(documentId);
    if (!existing) return undefined;

    const title = newTitle.trim();
    if (!title) return existing;

    const filename = buildDocumentFilename(title);
    const source = `agent-document://${existing.agentId}/${encodeURIComponent(filename)}`;
    const { uniqueSibling = true } = options;

    await this.db.transaction(async (trx) => {
      if (uniqueSibling) {
        await this.assertNoLiveSiblingConflict(trx, {
          agentId: existing.agentId,
          excludeAgentDocumentId: existing.id,
          filename,
          parentId: existing.parentId,
        });
      }

      await trx
        .update(documents)
        .set({
          filename,
          source,
          title,
        })
        .where(and(eq(documents.id, existing.documentId), eq(documents.userId, this.userId)));
    });

    return this.findById(documentId);
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
   * - `uniqueSibling` defaults to `true` for ordinary VFS documents
   *
   * Returns:
   * - The same agent document binding after the backing document row is moved
   *
   * NOTICE:
   * Pass `uniqueSibling: false` only for managed mount documents whose provider owns collision
   * handling outside the ordinary document VFS tree.
   */
  async movePath(
    documentId: string,
    params: { filename: string; parentId: string | null } & AgentDocumentSiblingUniquenessOptions,
  ): Promise<AgentDocument | undefined> {
    const existing = await this.findById(documentId);
    if (!existing) return undefined;

    const filename = params.filename.trim();
    if (!filename) return existing;

    const source = `agent-document://${existing.agentId}/${encodeURIComponent(filename)}`;
    const { uniqueSibling = true } = params;

    await this.db.transaction(async (trx) => {
      if (uniqueSibling) {
        await this.assertNoLiveSiblingConflict(trx, {
          agentId: existing.agentId,
          excludeAgentDocumentId: existing.id,
          filename,
          parentId: params.parentId,
        });
      }

      await trx
        .update(documents)
        .set({
          filename,
          parentId: params.parentId,
          source,
          title: filename,
        })
        .where(and(eq(documents.id, existing.documentId), eq(documents.userId, this.userId)));
    });

    return this.findById(documentId);
  }

  async copy(documentId: string, newTitle?: string): Promise<AgentDocument | undefined> {
    const existing = await this.findById(documentId);
    if (!existing) return undefined;

    const title = newTitle?.trim();
    const filename = title
      ? buildDocumentFilename(title)
      : `copy-${Date.now()}-${existing.filename}`;

    return this.create(existing.agentId, filename, existing.content, {
      editorData: existing.editorData || undefined,
      title,
      loadPosition:
        (existing.policy?.context?.position as DocumentLoadPosition | undefined) ||
        DocumentLoadPosition.BEFORE_FIRST_USER,
      loadRules: parseLoadRules(existing),
      metadata: existing.metadata || undefined,
      policy: existing.policy || undefined,
      policyLoad: existing.policyLoad as PolicyLoad | undefined,
      templateId: existing.templateId || undefined,
    });
  }

  async updateToolLoadRule(
    documentId: string,
    rule: ToolUpdateLoadRule,
  ): Promise<AgentDocument | undefined> {
    const existing = await this.findById(documentId);
    if (!existing) return undefined;
    const composedPolicy = composeToolPolicyUpdate(existing.policy, rule, existing.policyLoad);

    await this.db
      .update(agentDocuments)
      .set({
        policyLoad: composedPolicy.policyLoad,
        policy: composedPolicy.policy,
        policyLoadFormat: composedPolicy.policyLoadFormat,
        policyLoadRule: composedPolicy.policyLoadRule,
      })
      .where(
        and(
          eq(agentDocuments.id, documentId),
          eq(agentDocuments.userId, this.userId),
          isNull(agentDocuments.deletedAt),
        ),
      );

    return this.findById(documentId);
  }

  async findById(
    documentId: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    return this.findByIdWithOptions(documentId, options);
  }

  async findByIdWithOptions(
    documentId: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    const [result] = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.id, documentId),
          eq(agentDocuments.userId, this.userId),
          ...this.buildDeletedAtFilters(options),
        ),
      )
      .limit(1);

    if (!result) return undefined;

    return this.toAgentDocument(result.settings, result.doc);
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
   * - `uniqueSibling` is forwarded only to the create path and defaults to `true` there.
   *
   * Returns:
   * - The updated or created agent document.
   *
   * NOTICE:
   * Pass `uniqueSibling: false` only when the create path is creating managed mount documents
   * whose visible uniqueness is enforced by a provider-specific resolver.
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
    } & AgentDocumentSiblingUniquenessOptions,
  ): Promise<AgentDocument> {
    const {
      createdAt,
      editorData,
      uniqueSibling,
      loadPosition,
      loadRules,
      metadata,
      policy,
      policyLoad,
      templateId,
      updatedAt,
    } = params ?? {};

    const existing = await this.findByFilename(agentId, filename);

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

      return (await this.findByFilename(agentId, filename))!;
    }

    return this.create(agentId, filename, content, {
      createdAt,
      editorData,
      uniqueSibling,
      loadPosition,
      loadRules,
      metadata,
      policy,
      policyLoad,
      templateId,
      updatedAt,
    });
  }

  async findByAgent(agentId: string): Promise<AgentDocumentWithRules[]> {
    const results = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          isNull(agentDocuments.deletedAt),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt));

    return results.map(({ settings, doc }) => {
      const item = this.toAgentDocument(settings, doc);
      return {
        ...item,
        loadRules: parseLoadRules(item),
      };
    });
  }

  async findByDocumentIds(
    agentId: string,
    documentIds: string[],
  ): Promise<AgentDocumentWithRules[]> {
    if (documentIds.length === 0) return [];

    const results = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          inArray(agentDocuments.documentId, documentIds),
          isNull(agentDocuments.deletedAt),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt));

    return results.map(({ settings, doc }) => {
      const item = this.toAgentDocument(settings, doc);
      return {
        ...item,
        loadRules: parseLoadRules(item),
      };
    });
  }

  async hasByAgent(agentId: string): Promise<boolean> {
    const [result] = await this.db
      .select({ id: agentDocuments.id })
      .from(agentDocuments)
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          isNull(agentDocuments.deletedAt),
        ),
      )
      .limit(1);

    return !!result;
  }

  async findByTemplate(agentId: string, templateId: string): Promise<AgentDocumentWithRules[]> {
    const results = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          eq(agentDocuments.templateId, templateId),
          isNull(agentDocuments.deletedAt),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt));

    return results.map(({ settings, doc }) => {
      const item = this.toAgentDocument(settings, doc);
      return {
        ...item,
        loadRules: parseLoadRules(item),
      };
    });
  }

  async findByFilename(
    agentId: string,
    filename: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    const [result] = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          eq(documents.filename, filename),
          ...this.buildDeletedAtFilters(options),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt))
      .limit(1);

    if (!result) return undefined;

    return this.toAgentDocument(result.settings, result.doc);
  }

  async findByParentAndFilename(
    agentId: string,
    parentId: string | null,
    filename: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    const [result] = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          eq(documents.filename, filename),
          parentId ? eq(documents.parentId, parentId) : isNull(documents.parentId),
          ...this.buildDeletedAtFilters(options),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt))
      .limit(1);

    if (!result) return undefined;

    return this.toAgentDocument(result.settings, result.doc);
  }

  /**
   * Lists agent document bindings that share one tree segment.
   *
   * Use when:
   * - VFS callers need to reject ambiguous sibling paths before create, write, or restore
   * - Migration checks need to detect duplicate `parentId + filename` rows
   *
   * Expects:
   * - `parentId` is the canonical document row parent id, not the agent document id
   *
   * Returns:
   * - Matching bindings ordered newest first, optionally capped for conflict probes
   */
  async listByParentAndFilename(
    agentId: string,
    parentId: string | null,
    filename: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument[]> {
    const results = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          eq(documents.filename, filename),
          parentId ? eq(documents.parentId, parentId) : isNull(documents.parentId),
          ...this.buildDeletedAtFilters(options),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt))
      .limit(options?.limit ?? 9999)
      .offset(this.normalizeListOffset(options?.cursor));

    return results.map(({ settings, doc }) => this.toAgentDocument(settings, doc));
  }

  async findByDocumentId(
    agentId: string,
    documentId: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument | undefined> {
    const [result] = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          eq(agentDocuments.documentId, documentId),
          ...this.buildDeletedAtFilters(options),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt))
      .limit(1);

    if (!result) return undefined;

    return this.toAgentDocument(result.settings, result.doc);
  }

  async listByParent(
    agentId: string,
    parentId: string | null,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument[]> {
    const results = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          parentId ? eq(documents.parentId, parentId) : isNull(documents.parentId),
          ...this.buildDeletedAtFilters(options),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt))
      .limit(options?.limit ?? 9999)
      .offset(this.normalizeListOffset(options?.cursor));

    return results.map(({ settings, doc }) => this.toAgentDocument(settings, doc));
  }

  async listDeletedByAgent(agentId: string): Promise<AgentDocument[]> {
    const results = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          eq(documents.userId, this.userId),
          isNotNull(agentDocuments.deletedAt),
        ),
      )
      .orderBy(desc(agentDocuments.deletedAt), desc(agentDocuments.updatedAt));

    return results.map(({ settings, doc }) => this.toAgentDocument(settings, doc));
  }

  async listSubtreeByDocumentId(
    agentId: string,
    rootDocumentId: string,
    options?: AgentDocumentQueryOptions,
  ): Promise<AgentDocument[]> {
    const root = await this.findByDocumentId(agentId, rootDocumentId, options);

    if (!root) return [];

    const subtree = [root];
    const pendingParentIds = [root.documentId];

    while (pendingParentIds.length > 0) {
      const parentIds = pendingParentIds.splice(0, pendingParentIds.length);
      const children = await this.listByParentIds(agentId, parentIds, options);

      for (const child of children) {
        subtree.push(child);
        pendingParentIds.push(child.documentId);
      }
    }

    return subtree;
  }

  async delete(documentId: string, deleteReason?: string): Promise<void> {
    // Soft delete only: mark deleted metadata and stop autoload.
    // We intentionally keep both agent_documents row and linked documents row for recovery.
    await this.db
      .update(agentDocuments)
      .set({
        policyLoad: PolicyLoad.DISABLED,
        deleteReason,
        deletedAt: new Date(),
        deletedByAgentId: null,
        deletedByUserId: this.userId,
      })
      .where(
        and(
          eq(agentDocuments.id, documentId),
          eq(agentDocuments.userId, this.userId),
          isNull(agentDocuments.deletedAt),
        ),
      );
  }

  async deleteSubtreeByDocumentId(
    agentId: string,
    rootDocumentId: string,
    deleteReason?: string,
  ): Promise<void> {
    const subtree = await this.listSubtreeByDocumentId(agentId, rootDocumentId);

    if (subtree.length === 0) return;

    await this.db
      .update(agentDocuments)
      .set({
        policyLoad: PolicyLoad.DISABLED,
        deleteReason,
        deletedAt: new Date(),
        deletedByAgentId: null,
        deletedByUserId: this.userId,
      })
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          inArray(
            agentDocuments.id,
            subtree.map((item) => item.id),
          ),
          isNull(agentDocuments.deletedAt),
        ),
      );
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
   * - `uniqueSibling` defaults to `true` for ordinary VFS documents.
   *
   * Returns:
   * - Nothing; missing bindings are ignored.
   *
   * NOTICE:
   * Pass `uniqueSibling: false` only for managed mount documents whose provider owns restore
   * collision handling outside the ordinary document VFS tree.
   */
  async restore(
    documentId: string,
    options: AgentDocumentSiblingUniquenessOptions = {},
  ): Promise<void> {
    const existing = await this.findByIdWithOptions(documentId, { includeDeleted: true });

    if (!existing) return;
    const { uniqueSibling = true } = options;

    await this.db.transaction(async (trx) => {
      if (uniqueSibling) {
        await this.assertNoLiveSiblingConflict(trx, {
          agentId: existing.agentId,
          excludeAgentDocumentId: existing.id,
          filename: existing.filename,
          parentId: existing.parentId,
        });
      }

      await trx
        .update(agentDocuments)
        .set({
          deleteReason: null,
          deletedAt: null,
          deletedByAgentId: null,
          deletedByUserId: null,
          policyLoad: PolicyLoad.PROGRESSIVE,
        })
        .where(and(eq(agentDocuments.id, documentId), eq(agentDocuments.userId, this.userId)));
    });
  }

  async restoreSubtreeByDocumentId(agentId: string, rootDocumentId: string): Promise<void> {
    const subtree = await this.listSubtreeByDocumentId(agentId, rootDocumentId, {
      includeDeleted: true,
    });

    if (subtree.length === 0) return;

    await this.db
      .update(agentDocuments)
      .set({
        deleteReason: null,
        deletedAt: null,
        deletedByAgentId: null,
        deletedByUserId: null,
        policyLoad: PolicyLoad.PROGRESSIVE,
      })
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          inArray(
            agentDocuments.id,
            subtree.map((item) => item.id),
          ),
        ),
      );
  }

  async permanentlyDelete(documentId: string): Promise<void> {
    const existing = await this.findByIdWithOptions(documentId, { includeDeleted: true });

    if (!existing) return;

    await this.db.transaction(async (trx) => {
      await trx
        .delete(agentDocuments)
        .where(and(eq(agentDocuments.id, documentId), eq(agentDocuments.userId, this.userId)));

      await trx
        .delete(documents)
        .where(and(eq(documents.id, existing.documentId), eq(documents.userId, this.userId)));
    });
  }

  async permanentlyDeleteSubtreeByDocumentId(
    agentId: string,
    rootDocumentId: string,
  ): Promise<void> {
    const subtree = await this.listSubtreeByDocumentId(agentId, rootDocumentId, {
      includeDeleted: true,
    });

    if (subtree.length === 0) return;

    const agentDocumentIds = subtree.map((item) => item.id);
    const documentIds = subtree.map((item) => item.documentId);

    await this.db.transaction(async (trx) => {
      await trx
        .delete(agentDocuments)
        .where(
          and(eq(agentDocuments.userId, this.userId), inArray(agentDocuments.id, agentDocumentIds)),
        );

      await trx
        .delete(documents)
        .where(and(eq(documents.userId, this.userId), inArray(documents.id, documentIds)));
    });
  }

  async deleteByAgent(agentId: string, deleteReason?: string): Promise<void> {
    await this.db
      .update(agentDocuments)
      .set({
        policyLoad: PolicyLoad.DISABLED,
        deleteReason,
        deletedAt: new Date(),
        // NOTICE: mark for telling everyone that this should not ever marked as user id, no matter what circumstances
        deletedByAgentId: agentId,
        deletedByUserId: null,
      })
      .where(
        and(
          eq(agentDocuments.agentId, agentId),
          eq(agentDocuments.userId, this.userId),
          isNull(agentDocuments.deletedAt),
        ),
      );
  }

  async deleteByTemplate(
    agentId: string,
    templateId: string,
    deleteReason?: string,
  ): Promise<void> {
    await this.db
      .update(agentDocuments)
      .set({
        policyLoad: PolicyLoad.DISABLED,
        deleteReason,
        deletedAt: new Date(),
        deletedByAgentId: null,
        deletedByUserId: this.userId,
      })
      .where(
        and(
          eq(agentDocuments.agentId, agentId),
          eq(agentDocuments.templateId, templateId),
          eq(agentDocuments.userId, this.userId),
          isNull(agentDocuments.deletedAt),
        ),
      );
  }

  async getDocumentsByPosition(
    agentId: string,
  ): Promise<Map<DocumentLoadPosition, AgentDocumentWithRules[]>> {
    const docs = await this.getLoadableDocuments(agentId);
    const grouped = new Map<DocumentLoadPosition, AgentDocumentWithRules[]>();

    for (const doc of docs) {
      const position = resolveDocumentLoadPosition(doc);
      const existing = grouped.get(position) || [];

      existing.push(doc);
      grouped.set(position, sortByLoadRulePriority(existing));
    }

    return grouped;
  }

  async getLoadableDocuments(
    agentId: string,
    _context?: {
      currentTime?: Date;
      userMessage?: string;
    },
  ): Promise<AgentDocumentWithRules[]> {
    // Autoload gate: only documents explicitly marked as always-loadable are injected.
    // Agent access bits are enforced by caller/tool layer for interactive list/read/write actions.
    const docs = await this.findByAgent(agentId);
    return docs.filter((doc) => isLoadableDocument(doc));
  }

  async getInjectableDocuments(
    agentId: string,
    context?: {
      currentTime?: Date;
      userMessage?: string;
    },
  ): Promise<AgentDocumentWithRules[]> {
    return this.getLoadableDocuments(agentId, context);
  }

  async getAgentContext(agentId: string): Promise<string> {
    const docs = await this.getLoadableDocuments(agentId);

    if (docs.length === 0) {
      return '';
    }

    const contextParts: string[] = [];

    for (const doc of docs) {
      if (doc.content) {
        contextParts.push(`--- ${doc.filename} ---`);
        contextParts.push(doc.content);
        contextParts.push('');
      }
    }

    return contextParts.join('\n').trim();
  }
}
