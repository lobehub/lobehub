import { and, desc, eq, isNull } from 'drizzle-orm';

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
      filename: doc.filename ?? '',
      id: settings.id,
      metadata: (doc.metadata as Record<string, any> | null) ?? null,
      policy,
      policyLoadFormat,
      policyLoadPosition: settings.policyLoadPosition,
      policyLoadRule: settings.policyLoadRule,
      templateId: settings.templateId ?? null,
      title: doc.title ?? doc.filename ?? '',
      updatedAt: settings.updatedAt,
      userId: settings.userId,
    };
  }

  async create(
    agentId: string,
    filename: string,
    content: string,
    params?: {
      createdAt?: Date;
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
      loadPosition,
      loadRules,
      metadata,
      policy,
      policyLoad,
      templateId,
      updatedAt,
    } = params ?? {};

    const title = filename.replace(/\.[^.]+$/, '');
    const stats = this.getDocumentStats(content);
    const normalizedPolicy = normalizePolicy(loadPosition, loadRules, policy);

    return this.db.transaction(async (trx) => {
      const documentPayload: NewDocument = {
        content,
        createdAt,
        description: metadata?.description,
        fileType: 'agent/document',
        filename,
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
      loadPosition?: DocumentLoadPosition;
      loadRules?: Partial<DocumentLoadRules>;
      metadata?: Record<string, any>;
      policy?: AgentDocumentPolicy;
      policyLoad?: PolicyLoad;
    },
  ): Promise<void> {
    const { content, loadPosition, loadRules, metadata, policy, policyLoad } = params ?? {};

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
      if (content !== undefined || metadata !== undefined) {
        const documentUpdate: Partial<NewDocument> = {};

        if (content !== undefined) {
          const stats = this.getDocumentStats(content);
          documentUpdate.content = content;
          documentUpdate.totalCharCount = stats.totalCharCount;
          documentUpdate.totalLineCount = stats.totalLineCount;
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

  async rename(documentId: string, newTitle: string): Promise<AgentDocument | undefined> {
    const existing = await this.findById(documentId);
    if (!existing) return undefined;

    const title = newTitle.trim();
    if (!title) return existing;

    const filename = buildDocumentFilename(title, existing.filename);
    const source = `agent-document://${existing.agentId}/${encodeURIComponent(filename)}`;

    await this.db
      .update(documents)
      .set({
        filename,
        source,
        title,
      })
      .where(and(eq(documents.id, existing.documentId), eq(documents.userId, this.userId)));

    return this.findById(documentId);
  }

  async copy(documentId: string, newTitle?: string): Promise<AgentDocument | undefined> {
    const existing = await this.findById(documentId);
    if (!existing) return undefined;

    const title = newTitle?.trim();
    const filename = title
      ? buildDocumentFilename(title, existing.filename)
      : `copy-${Date.now()}-${existing.filename}`;

    return this.create(existing.agentId, filename, existing.content, {
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

  async findById(documentId: string): Promise<AgentDocument | undefined> {
    const [result] = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.id, documentId),
          eq(agentDocuments.userId, this.userId),
          isNull(agentDocuments.deletedAt),
        ),
      )
      .limit(1);

    if (!result) return undefined;

    return this.toAgentDocument(result.settings, result.doc);
  }

  async upsert(
    agentId: string,
    filename: string,
    content: string,
    params?: {
      createdAt?: Date;
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

  async findByFilename(agentId: string, filename: string): Promise<AgentDocument | undefined> {
    const [result] = await this.db
      .select({ doc: documents, settings: agentDocuments })
      .from(agentDocuments)
      .innerJoin(documents, eq(agentDocuments.documentId, documents.id))
      .where(
        and(
          eq(agentDocuments.userId, this.userId),
          eq(agentDocuments.agentId, agentId),
          eq(documents.filename, filename),
          isNull(agentDocuments.deletedAt),
        ),
      )
      .orderBy(desc(agentDocuments.updatedAt))
      .limit(1);

    if (!result) return undefined;

    return this.toAgentDocument(result.settings, result.doc);
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
