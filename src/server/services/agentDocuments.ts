import {
  type AgentDocumentPolicy,
  type DOCUMENT_TEMPLATES,
  DocumentLoadPosition,
  type DocumentLoadRules,
  type DocumentTemplateSet,
  getDocumentTemplate,
  type PolicyLoad,
} from '@lobechat/agent-templates';
import type { LobeChatDatabase } from '@lobechat/database';

import {
  AgentDocumentModel,
  type AgentDocumentWithRules,
  type ToolUpdateLoadRule,
} from '@/database/models/agentDocuments';
import { buildDocumentFilename } from '@/database/models/agentDocuments';

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

/**
 * Service for managing agent documents with reusable template sets.
 * Document-level policy controls runtime behavior (context rendering/retrieval).
 */
export class AgentDocumentsService {
  private agentDocumentModel: AgentDocumentModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.agentDocumentModel = new AgentDocumentModel(db, userId);
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
    const extensionMatch = baseFilename.match(/(\.[^./\\]+)$/);
    const extension = extensionMatch?.[1] || '.txt';
    const baseName = baseFilename.slice(0, -extension.length);

    let filename = baseFilename;
    let suffix = 2;

    while (await this.agentDocumentModel.findByFilename(agentId, filename)) {
      if (suffix > MAX_UNIQUE_FILENAME_ATTEMPTS) {
        throw new Error(
          `Unable to generate a unique filename for "${title}" after ${MAX_UNIQUE_FILENAME_ATTEMPTS} attempts.`,
        );
      }

      filename = `${baseName}-${suffix}${extension}`;
      suffix += 1;
    }

    return this.agentDocumentModel.create(agentId, filename, content, params);
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
      await this.agentDocumentModel.upsert(agentId, template.filename, template.content, {
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
      await this.agentDocumentModel.upsert(agentId, template.filename, template.content, {
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
    return this.agentDocumentModel.findByAgent(agentId);
  }

  async getDocumentsByTemplate(
    agentId: string,
    templateId: string,
  ): Promise<AgentDocumentWithRules[]> {
    return this.agentDocumentModel.findByTemplate(agentId, templateId);
  }

  async getDocumentsByPolicy(agentId: string, policyId: string): Promise<AgentDocumentWithRules[]> {
    return this.getDocumentsByTemplate(agentId, policyId);
  }

  async getDocument(agentId: string, filename: string) {
    return this.agentDocumentModel.findByFilename(agentId, filename);
  }

  async getDocumentById(id: string, expectedAgentId?: string) {
    return this.getDocumentByIdInAgent(id, expectedAgentId);
  }

  private async getDocumentByIdInAgent(documentId: string, expectedAgentId?: string) {
    const doc = await this.agentDocumentModel.findById(documentId);

    if (!doc) return undefined;
    if (expectedAgentId && doc.agentId !== expectedAgentId) return undefined;

    return doc;
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
    return this.agentDocumentModel.upsert(agentId, filename, content, {
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

  async createDocument(agentId: string, title: string, content: string) {
    return this.createWithUniqueFilename(agentId, title, content);
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
    return this.agentDocumentModel.getInjectableDocuments(agentId, context);
  }

  async getDocumentsByPosition(agentId: string) {
    return this.agentDocumentModel.getDocumentsByPosition(agentId);
  }

  async getAgentContext(agentId: string): Promise<string> {
    return this.agentDocumentModel.getAgentContext(agentId);
  }

  async getDocumentsMap(agentId: string) {
    const docs = await this.agentDocumentModel.findByAgent(agentId);
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
      filename: d.filename,
      id: d.id,
      loadPosition: d.policy?.context?.position,
      title: d.title,
    }));
  }

  async getDocumentByFilename(agentId: string, filename: string) {
    return this.agentDocumentModel.findByFilename(agentId, filename);
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
    return this.agentDocumentModel.upsert(agentId, filename, content);
  }

  async editDocumentById(documentId: string, content: string, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

    await this.agentDocumentModel.update(documentId, { content });
    return this.agentDocumentModel.findById(documentId);
  }

  async renameDocumentById(documentId: string, newTitle: string, expectedAgentId?: string) {
    const doc = await this.getDocumentByIdInAgent(documentId, expectedAgentId);
    if (!doc) return undefined;

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
