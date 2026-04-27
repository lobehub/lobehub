import type {
  AgentDocumentPolicy,
  DOCUMENT_TEMPLATES,
  DocumentLoadRules,
  DocumentTemplateSet,
  PolicyLoad,
} from '@lobechat/agent-templates';
import { DocumentLoadPosition, getDocumentTemplate } from '@lobechat/agent-templates';
import type { LobeChatDatabase } from '@lobechat/database';

import type {
  AgentDocument,
  AgentDocumentWithRules,
  ToolUpdateLoadRule,
} from '@/database/models/agentDocuments';
import {
  AgentDocumentModel,
  buildDocumentFilename,
  extractMarkdownH1Title,
} from '@/database/models/agentDocuments';
import { TopicDocumentModel } from '@/database/models/topicDocument';

import {
  type AgentDocumentLiteXMLOperation,
  applyLiteXMLOperations,
  createMarkdownEditorSnapshot,
  exportEditorDataSnapshot,
} from './agentDocuments/headlessEditor';
import { DocumentService } from './document';

const MAX_UNIQUE_FILENAME_ATTEMPTS = 1000;

interface UpsertDocumentParams {
  agentId: string;
  content: string;
  createdAt?: Date;
  filename: string;
  loadPosition?: DocumentLoadPosition;
  loadRules?: DocumentLoadRules;
  metadata?: Record<string, any>;
  policy?: AgentDocumentPolicy;
  policyLoad?: PolicyLoad;
  templateId?: string;
  updatedAt?: Date;
}

type AgentDocumentWithLiteXML = AgentDocument & { litexml?: string };

/**
 * Service for managing agent documents with reusable template sets.
 * Document-level policy controls runtime behavior (context rendering/retrieval).
 */
export class AgentDocumentsService {
  private agentDocumentModel: AgentDocumentModel;
  private documentService: DocumentService;
  private topicDocumentModel: TopicDocumentModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.agentDocumentModel = new AgentDocumentModel(db, userId);
    this.documentService = new DocumentService(db, userId);
    this.topicDocumentModel = new TopicDocumentModel(db, userId);
  }

  private async projectDocumentContent<T extends AgentDocument | AgentDocumentWithRules>(
    doc: T,
  ): Promise<T>;
  private async projectDocumentContent<T extends AgentDocument | AgentDocumentWithRules>(
    doc: T | undefined,
  ): Promise<T | undefined>;
  private async projectDocumentContent<T extends AgentDocument | AgentDocumentWithRules>(
    doc: T | undefined,
  ): Promise<T | undefined> {
    if (!doc?.editorData) return doc;

    try {
      const snapshot = await exportEditorDataSnapshot({
        editorData: doc.editorData,
        fallbackContent: doc.content,
      });

      return { ...doc, content: snapshot.content };
    } catch (error) {
      console.error('[AgentDocumentsService] Failed to project editorData to Markdown:', error);
      return doc;
    }
  }

  private async projectDocuments<T extends AgentDocument | AgentDocumentWithRules>(
    docs: T[],
  ): Promise<T[]> {
    return Promise.all(docs.map((doc) => this.projectDocumentContent(doc)));
  }

  private async attachLiteXML(doc: AgentDocument): Promise<AgentDocumentWithLiteXML> {
    const snapshot = await exportEditorDataSnapshot({
      editorData: doc.editorData,
      fallbackContent: doc.content,
      litexml: true,
    });

    return { ...doc, content: snapshot.content, litexml: snapshot.litexml };
  }

  private async createWithUniqueFilename(
    agentId: string,
    title: string,
    content: string,
    params?: {
      loadPosition?: DocumentLoadPosition;
      loadRules?: DocumentLoadRules;
      metadata?: Record<string, any>;
      policy?: AgentDocumentPolicy;
      templateId?: string;
    },
  ) {
    const baseFilename = buildDocumentFilename(title);

    let filename = baseFilename;
    let suffix = 2;

    while (await this.agentDocumentModel.findByFilename(agentId, filename)) {
      if (suffix > MAX_UNIQUE_FILENAME_ATTEMPTS) {
        throw new Error(
          `Unable to generate a unique filename for "${title}" after ${MAX_UNIQUE_FILENAME_ATTEMPTS} attempts.`,
        );
      }

      filename = `${baseFilename}-${suffix}`;
      suffix += 1;
    }

    const snapshot = await createMarkdownEditorSnapshot(content);

    return this.agentDocumentModel.create(agentId, filename, snapshot.content, {
      ...params,
      editorData: snapshot.editorData,
      title,
    });
  }

  /**
   * Initialize documents from a specific template set.
   */
  async initializeFromTemplate(
    agentId: string,
    templateId: keyof typeof DOCUMENT_TEMPLATES = 'claw',
  ) {
    const templateSet = getDocumentTemplate(templateId);

    for (const template of templateSet.templates) {
      await this.upsertDocument({
        agentId,
        content: template.content,
        filename: template.filename,
        loadPosition: template.loadPosition,
        loadRules: template.loadRules,
        metadata: template.metadata,
        policy: template.policyLoadFormat
          ? { context: { policyLoadFormat: template.policyLoadFormat } }
          : undefined,
        policyLoad: template.policyLoad,
        templateId,
      });
    }
  }

  /**
   * Initialize from a custom template set.
   */
  async initializeFromCustomTemplate(agentId: string, templateSet: DocumentTemplateSet) {
    for (const template of templateSet.templates) {
      await this.upsertDocument({
        agentId,
        content: template.content,
        filename: template.filename,
        loadPosition: template.loadPosition,
        loadRules: template.loadRules,
        metadata: template.metadata,
        policy: template.policyLoadFormat
          ? { context: { policyLoadFormat: template.policyLoadFormat } }
          : undefined,
        policyLoad: template.policyLoad,
        templateId: templateSet.id,
      });
    }
  }

  /**
   * Switch agent to a different template set.
   * Optionally preserves custom document modifications.
   */
  async switchTemplate(agentId: string, newTemplateId: string, preserveCustomizations = false) {
    if (!preserveCustomizations) {
      await this.agentDocumentModel.deleteByAgent(agentId);
    }

    await this.initializeFromTemplate(agentId, newTemplateId as keyof typeof DOCUMENT_TEMPLATES);
  }

  /**
   * Backward-compatible alias.
   */
  async initializeFromPolicy(agentId: string, policyId: keyof typeof DOCUMENT_TEMPLATES = 'claw') {
    return this.initializeFromTemplate(agentId, policyId);
  }

  /**
   * Backward-compatible alias.
   */
  async initializeFromCustomPolicy(agentId: string, policy: DocumentTemplateSet) {
    return this.initializeFromCustomTemplate(agentId, policy);
  }

  /**
   * Backward-compatible alias.
   */
  async switchPolicy(agentId: string, newPolicyId: string, preserveCustomizations = false) {
    return this.switchTemplate(agentId, newPolicyId, preserveCustomizations);
  }

  async getAgentDocuments(agentId: string): Promise<AgentDocumentWithRules[]> {
    const docs = await this.agentDocumentModel.findByAgent(agentId);
    return this.projectDocuments(docs);
  }

  async getDocumentsByTemplate(
    agentId: string,
    templateId: string,
  ): Promise<AgentDocumentWithRules[]> {
    const docs = await this.agentDocumentModel.findByTemplate(agentId, templateId);
    return this.projectDocuments(docs);
  }

  async getDocumentsByPolicy(agentId: string, policyId: string): Promise<AgentDocumentWithRules[]> {
    return this.getDocumentsByTemplate(agentId, policyId);
  }

  async getDocument(agentId: string, filename: string) {
    const doc = await this.agentDocumentModel.findByFilename(agentId, filename);
    return this.projectDocumentContent(doc);
  }

  async getDocumentById(id: string, expectedAgentId?: string) {
    return this.getDocumentByIdInAgent(id, expectedAgentId);
  }

  async getDocumentSnapshotById(id: string, expectedAgentId?: string) {
    const doc = await this.agentDocumentModel.findById(id);

    if (!doc) return undefined;
    if (expectedAgentId && doc.agentId !== expectedAgentId) return undefined;

    return this.attachLiteXML(doc);
  }

  async getDocumentSnapshotByFilename(agentId: string, filename: string) {
    const doc = await this.agentDocumentModel.findByFilename(agentId, filename);
    if (!doc) return undefined;

    return this.attachLiteXML(doc);
  }

  private async getDocumentByIdInAgent(documentId: string, expectedAgentId?: string) {
    const doc = await this.agentDocumentModel.findById(documentId);

    if (!doc) return undefined;
    if (expectedAgentId && doc.agentId !== expectedAgentId) return undefined;

    return this.projectDocumentContent(doc);
  }

  async upsertDocument({
    agentId,
    filename,
    content,
    loadPosition,
    loadRules,
    templateId,
    metadata,
    policy,
    policyLoad,
    createdAt,
    updatedAt,
  }: UpsertDocumentParams) {
    const snapshot = await createMarkdownEditorSnapshot(content);

    return this.agentDocumentModel.upsert(agentId, filename, snapshot.content, {
      createdAt,
      editorData: snapshot.editorData,
      loadPosition,
      loadRules,
      metadata,
      policy,
      policyLoad,
      templateId,
      updatedAt,
    });
  }

  async associateDocument(agentId: string, documentId: string): Promise<{ id: string }> {
    return this.agentDocumentModel.associate({ agentId, documentId });
  }

  async createDocument(agentId: string, title: string, content: string) {
    const { title: extractedTitle, content: strippedContent } = extractMarkdownH1Title(content);
    const finalTitle = extractedTitle || title;
    return this.createWithUniqueFilename(agentId, finalTitle, strippedContent);
  }

  async createForTopic(agentId: string, title: string, content: string, topicId: string) {
    const doc = await this.createDocument(agentId, title, content);

    await this.topicDocumentModel.associate({
      documentId: doc.documentId,
      topicId,
    });

    return doc;
  }

  async deleteDocument(documentId: string) {
    return this.agentDocumentModel.delete(documentId);
  }

  async removeDocumentById(documentId: string, expectedAgentId?: string): Promise<boolean> {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return false;

    await this.deleteDocument(documentId);
    return true;
  }

  async deleteAllDocuments(agentId: string) {
    return this.agentDocumentModel.deleteByAgent(agentId);
  }

  async deleteTemplateDocuments(agentId: string, templateId: string) {
    return this.agentDocumentModel.deleteByTemplate(agentId, templateId);
  }

  async deletePolicyDocuments(agentId: string, policyId: string) {
    return this.deleteTemplateDocuments(agentId, policyId);
  }

  async getInjectableDocuments(
    agentId: string,
    context: {
      userMessage?: string;
      currentTime?: Date;
    },
  ): Promise<AgentDocumentWithRules[]> {
    const docs = await this.agentDocumentModel.getInjectableDocuments(agentId, context);
    return this.projectDocuments(docs);
  }

  async getDocumentsByPosition(agentId: string) {
    const grouped = await this.agentDocumentModel.getDocumentsByPosition(agentId);
    const projected = new Map<DocumentLoadPosition, AgentDocumentWithRules[]>();

    for (const [position, docs] of grouped.entries()) {
      projected.set(position, await this.projectDocuments(docs));
    }

    return projected;
  }

  async getAgentContext(agentId: string): Promise<string> {
    const docs = await this.getInjectableDocuments(agentId, {});

    if (docs.length === 0) return '';

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

  async getDocumentsMap(agentId: string) {
    const docs = await this.getAgentDocuments(agentId);
    return new Map(docs.map((doc) => [doc.filename, doc.content]));
  }

  async hasDocuments(agentId: string): Promise<boolean> {
    return this.agentDocumentModel.hasByAgent(agentId);
  }

  async getAgentTemplate(agentId: string): Promise<string | null> {
    const docs = await this.getAgentDocuments(agentId);
    if (docs.length === 0) return null;

    const templateCounts = new Map<string, number>();
    for (const doc of docs) {
      if (doc.templateId) {
        templateCounts.set(doc.templateId, (templateCounts.get(doc.templateId) || 0) + 1);
      }
    }

    let maxCount = 0;
    let currentTemplate: string | null = null;
    for (const [templateId, count] of templateCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        currentTemplate = templateId;
      }
    }

    return currentTemplate;
  }

  async getAgentPolicy(agentId: string): Promise<string | null> {
    return this.getAgentTemplate(agentId);
  }

  async cloneDocuments(sourceAgentId: string, targetAgentId: string) {
    const sourceDocs = await this.getAgentDocuments(sourceAgentId);

    for (const doc of sourceDocs) {
      await this.upsertDocument({
        agentId: targetAgentId,
        content: doc.content,
        filename: doc.filename,
        loadPosition:
          (doc.policy?.context?.position as DocumentLoadPosition | undefined) ||
          DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: doc.loadRules,
        metadata: doc.metadata || undefined,
        policy: doc.policy || undefined,
        templateId: doc.templateId || undefined,
      });
    }
  }

  async listDocuments(agentId: string) {
    const docs = await this.agentDocumentModel.findByAgent(agentId);
    return docs.map((d) => ({
      documentId: d.documentId,
      filename: d.filename,
      id: d.id,
      loadPosition: d.policy?.context?.position,
      title: d.title,
    }));
  }

  async listDocumentsForTopic(agentId: string, topicId: string) {
    const topicDocs = await this.topicDocumentModel.findByTopicId(topicId);
    const documentIds = topicDocs.map((doc) => doc.id);
    const docs = await this.agentDocumentModel.findByDocumentIds(agentId, documentIds);
    const docsByDocumentId = new Map(docs.map((doc) => [doc.documentId, doc]));

    return topicDocs
      .map((topicDoc) => docsByDocumentId.get(topicDoc.id))
      .filter((doc): doc is AgentDocumentWithRules => Boolean(doc))
      .map((doc) => ({
        documentId: doc.documentId,
        filename: doc.filename,
        id: doc.id,
        loadPosition: doc.policy?.context?.position,
        title: doc.title,
      }));
  }

  async getDocumentByFilename(agentId: string, filename: string) {
    const doc = await this.agentDocumentModel.findByFilename(agentId, filename);
    return this.projectDocumentContent(doc);
  }

  async upsertDocumentByFilename({
    agentId,
    filename,
    content,
  }: {
    agentId: string;
    content: string;
    filename: string;
  }) {
    const existing = await this.agentDocumentModel.findByFilename(agentId, filename);
    const projectedExisting = await this.projectDocumentContent(existing);
    const snapshot = await createMarkdownEditorSnapshot(content);

    if (existing && projectedExisting?.content !== snapshot.content) {
      await this.documentService.trySaveCurrentDocumentHistory(existing.documentId, 'llm_call');
    }

    return this.agentDocumentModel.upsert(agentId, filename, snapshot.content, {
      editorData: snapshot.editorData,
    });
  }

  async editDocumentById(documentId: string, content: string, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;
    const snapshot = await createMarkdownEditorSnapshot(content);

    if (doc.content !== snapshot.content) {
      await this.documentService.trySaveCurrentDocumentHistory(doc.documentId, 'llm_call');
    }

    await this.agentDocumentModel.update(documentId, {
      content: snapshot.content,
      editorData: snapshot.editorData,
    });
    return this.getDocumentByIdInAgent(documentId, expectedAgentId);
  }

  async modifyDocumentNodesById(
    documentId: string,
    operations: AgentDocumentLiteXMLOperation[],
    expectedAgentId?: string,
  ) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

    await this.documentService.trySaveCurrentDocumentHistory(doc.documentId, 'llm_call');

    const snapshot = await applyLiteXMLOperations({
      editorData: doc.editorData,
      fallbackContent: doc.content,
      operations,
    });

    await this.agentDocumentModel.update(documentId, {
      content: snapshot.content,
      editorData: snapshot.editorData,
    });

    return this.getDocumentByIdInAgent(documentId, expectedAgentId);
  }

  async renameDocumentById(documentId: string, newTitle: string, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

    const title = newTitle.trim();
    if (title && title !== doc.title) {
      await this.documentService.trySaveCurrentDocumentHistory(doc.documentId, 'llm_call');
    }

    return this.agentDocumentModel.rename(documentId, newTitle);
  }

  async copyDocumentById(documentId: string, newTitle?: string, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

    return this.agentDocumentModel.copy(documentId, newTitle);
  }

  async updateLoadRuleById(documentId: string, rule: ToolUpdateLoadRule, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

    return this.agentDocumentModel.updateToolLoadRule(documentId, rule);
  }

  async exportAsTemplate(agentId: string, templateName: string): Promise<DocumentTemplateSet> {
    const docs = await this.getAgentDocuments(agentId);

    return {
      id: `custom-${agentId}`,
      name: templateName,
      description: `Custom template exported from agent ${agentId}`,
      tags: ['custom', 'exported'],
      templates: docs.map((doc) => ({
        title: doc.title,
        filename: doc.filename,
        description: `Exported from ${doc.filename}`,
        content: doc.content,
        loadPosition:
          (doc.policy?.context?.position as DocumentLoadPosition | undefined) ||
          DocumentLoadPosition.BEFORE_FIRST_USER,
        loadRules: doc.loadRules,
        metadata: doc.metadata || undefined,
      })),
    };
  }

  async exportAsPolicy(agentId: string, policyName: string): Promise<DocumentTemplateSet> {
    return this.exportAsTemplate(agentId, policyName);
  }
}
