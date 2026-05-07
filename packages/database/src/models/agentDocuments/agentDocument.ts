import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type { DocumentItem, NewAgentDocument, NewDocument } from '../../schemas';
import { agentDocuments, documents } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
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
  AgentDocumentSourceType,
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

interface AgentDocumentCreateParams {
  createdAt?: Date;
  editorData?: Record<string, any>;
  fileType?: string;
  loadPosition?: DocumentLoadPosition;
  loadRules?: DocumentLoadRules;
  metadata?: Record<string, any>;
  parentId?: string | null;
  policy?: AgentDocumentPolicy;
  policyLoad?: PolicyLoad;
  source?: string;
  sourceType?: AgentDocumentSourceType;
  templateId?: string;
  title?: string;
  updatedAt?: Date;
}

interface ConvertAgentDocumentToSkillIndexParams {
  agentDocumentId: string;
  content: string;
  editorData?: Record<string, unknown>;
  filename: string;
  metadata: Record<string, unknown>;
  parentId: string;
  source: string;
  sourceType: AgentDocumentSourceType;
  title: string;
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

  private getMetadataDescription(metadata?: Record<string, unknown> | null): string | undefined {
    if (!metadata) return undefined;

    if (typeof metadata.description === 'string') return metadata.description;

    const skill = metadata.skill;
    if (!skill || typeof skill !== 'object') return undefined;

    const frontmatter = (skill as Record<string, unknown>).frontmatter;
    if (!frontmatter || typeof frontmatter !== 'object') return undefined;

    const description = (frontmatter as Record<string, unknown>).description;
    return typeof description === 'string' ? description : undefined;
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
      .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id));

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
   * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately.
   *
   * Returns:
   * - The inserted agent document binding id, or an empty id when the source document is missing.
   *
   */
  async associate(params: {
    agentId: string;
    documentId: string;
    policyLoad?: PolicyLoad;
  }): Promise<{ id: string }> {
    const { agentId, documentId, policyLoad } = params;

    return this.db.transaction(async (trx) => {
      const [doc] = await trx
        .select()
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.userId, this.userId)))
        .limit(1);

      if (!doc) return { id: '' };

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
    return this.db.transaction((trx) => this.createWithTx(trx, agentId, filename, content, params));
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
    const {
      createdAt,
      editorData,
      fileType = 'agent/document',
      loadPosition,
      loadRules,
      metadata,
      parentId,
      policy,
      policyLoad,
      source,
      sourceType = 'agent',
      templateId,
      title: providedTitle,
      updatedAt,
    } = params ?? {};

    const title = providedTitle?.trim() || filename.replace(/\.[^.]+$/, '');
    const stats = this.getDocumentStats(content);
    const normalizedPolicy = normalizePolicy(loadPosition, loadRules, policy);

    const documentPayload: NewDocument = {
      content,
      createdAt,
      description: this.getMetadataDescription(metadata),
      editorData,
      fileType,
      filename,
      parentId,
      metadata,
      source: source ?? `agent-document://${agentId}/${encodeURIComponent(filename)}`,
      sourceType,
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
    return this.db.transaction((trx) => this.convertAgentDocumentToSkillIndexWithTx(trx, params));
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
    const [existingResult] = await trx
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.id, params.agentDocumentId),
          eq(agentDocuments.userId, this.userId),
          isNull(agentDocuments.deletedAt),
        ),
      )
      .limit(1);

    if (!existingResult) return undefined;

    const existing = this.toAgentDocument(existingResult.settings, existingResult.doc);
    if (!existing) return undefined;

    const stats = this.getDocumentStats(params.content);
    const updatedAt = new Date();

    await trx
      .update(documents)
      .set({
        content: params.content,
        description: this.getMetadataDescription(params.metadata),
        ...(params.editorData !== undefined && { editorData: params.editorData }),
        filename: params.filename,
        fileType: 'skills/index',
        metadata: params.metadata,
        parentId: params.parentId,
        source: params.source,
        sourceType: params.sourceType,
        title: params.title,
        totalCharCount: stats.totalCharCount,
        totalLineCount: stats.totalLineCount,
        updatedAt,
      })
      .where(and(eq(documents.id, existing.documentId), eq(documents.userId, this.userId)));

    await trx
      .update(agentDocuments)
      .set({
        policyLoad: PolicyLoad.DISABLED,
        templateId: 'agent-skill',
        updatedAt,
      })
      .where(
        and(
          eq(agentDocuments.id, params.agentDocumentId),
          eq(agentDocuments.userId, this.userId),
          isNull(agentDocuments.deletedAt),
        ),
      );

    const [updatedResult] = await trx
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.id, params.agentDocumentId),
          eq(agentDocuments.userId, this.userId),
          isNull(agentDocuments.deletedAt),
        ),
      )
      .limit(1);

    return updatedResult
      ? this.toAgentDocument(updatedResult.settings, updatedResult.doc)
      : undefined;
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
          documentUpdate.description = this.getMetadataDescription(metadata);
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
    const existing = await this.findById(agentDocumentId);
    if (!existing) return undefined;

    if (
      params.filename === undefined &&
      params.metadata === undefined &&
      params.parentId === undefined &&
      params.title === undefined
    ) {
      return existing;
    }

    await this.db
      .update(documents)
      .set({
        ...(params.filename !== undefined && { filename: params.filename }),
        ...(params.metadata !== undefined && {
          description: this.getMetadataDescription(params.metadata),
          metadata: params.metadata,
        }),
        ...(params.parentId !== undefined && { parentId: params.parentId }),
        ...(params.title !== undefined && { title: params.title }),
      })
      .where(and(eq(documents.id, existing.documentId), eq(documents.userId, this.userId)));

    return this.findById(agentDocumentId);
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
  async rename(documentId: string, newTitle: string): Promise<AgentDocument | undefined> {
    const existing = await this.findById(documentId);
    if (!existing) return undefined;

    const title = newTitle.trim();
    if (!title) return existing;

    const filename = buildDocumentFilename(title);
    const source = `agent-document://${existing.agentId}/${encodeURIComponent(filename)}`;

    await this.db.transaction(async (trx) => {
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
   * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately
   *
   * Returns:
   * - The same agent document binding after the backing document row is moved
   *
   */
  async movePath(
    documentId: string,
    params: { filename: string; parentId: string | null },
  ): Promise<AgentDocument | undefined> {
    const existing = await this.findById(documentId);
    if (!existing) return undefined;

    const filename = params.filename.trim();
    if (!filename) return existing;

    const source = `agent-document://${existing.agentId}/${encodeURIComponent(filename)}`;

    await this.db.transaction(async (trx) => {
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
      .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id))
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
      .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id))
      .limit(1);

    if (!result) return undefined;

    return this.toAgentDocument(result.settings, result.doc);
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
      .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id))
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
      .orderBy(asc(agentDocuments.createdAt), asc(agentDocuments.id))
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
   * - Duplicate filenames are allowed; path-style callers resolve visible duplicates separately.
   *
   * Returns:
   * - Nothing; missing bindings are ignored.
   *
   */
  async restore(documentId: string): Promise<void> {
    const existing = await this.findByIdWithOptions(documentId, { includeDeleted: true });

    if (!existing) return;

    await this.db.transaction(async (trx) => {
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
