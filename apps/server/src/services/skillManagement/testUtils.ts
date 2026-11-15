import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import { vi } from 'vitest';

import {
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  PolicyLoad,
} from '@/database/models/agentDocuments';

import type { AgentDocumentEditorSnapshot } from '../agentDocuments/headlessEditor';
import type { DocumentService } from '../document';
import type { SKILL_MANAGEMENT_SOURCE_TYPE } from './constants';
import { AGENT_SKILL_TEMPLATE_ID, SKILL_INDEX_FILE_TYPE } from './constants';
import type { SkillManagementAgentDocumentModel } from './SkillManagementDocumentService';
import { SkillManagementDocumentService } from './SkillManagementDocumentService';
import type { SkillAgentDocument } from './types';

export const now = new Date('2026-05-02T00:00:00.000Z');
export const backingDocumentUpdatedAt = new Date('2026-05-03T00:00:00.000Z');

export const createSnapshot = vi.fn(
  async (content: string): Promise<AgentDocumentEditorSnapshot> => ({
    content,
    editorData: { markdown: content, root: { children: [{ type: 'paragraph' }], type: 'root' } },
  }),
);

export const expectedEditorData = (content: string) => ({
  markdown: content,
  root: { children: [{ type: 'paragraph' }], type: 'root' },
});

export class InMemoryAgentDocumentModel implements SkillManagementAgentDocumentModel {
  documents: SkillAgentDocument[] = [];
  createCalls: Array<{
    agentId: string;
    content: string;
    filename: string;
    params?: Record<string, unknown>;
  }> = [];
  identityUpdateCalls: Array<{ agentDocumentId: string; params: Record<string, unknown> }> = [];
  updateCalls: Array<{ agentDocumentId: string; params?: Record<string, unknown> }> = [];

  private nextId = 1;

  async convertAgentDocumentToSkillIndex(params: {
    agentDocumentId: string;
    content: string;
    editorData?: Record<string, unknown>;
    filename: string;
    metadata: Record<string, unknown>;
    parentId: string;
    source: string;
    sourceType: typeof SKILL_MANAGEMENT_SOURCE_TYPE;
    title: string;
  }): Promise<SkillAgentDocument | undefined> {
    return this.convertAgentDocumentToSkillIndexWithTx({} as Transaction, params);
  }

  async convertAgentDocumentToSkillIndexWithTx(
    _trx: Transaction,
    params: {
      agentDocumentId: string;
      content: string;
      editorData?: Record<string, unknown>;
      filename: string;
      metadata: Record<string, unknown>;
      parentId: string;
      source: string;
      sourceType: typeof SKILL_MANAGEMENT_SOURCE_TYPE;
      title: string;
    },
  ): Promise<SkillAgentDocument | undefined> {
    const existing = this.documents.find((doc) => doc.id === params.agentDocumentId);
    if (!existing) return undefined;

    Object.assign(existing, {
      content: params.content,
      ...(params.editorData !== undefined && { editorData: params.editorData }),
      fileType: SKILL_INDEX_FILE_TYPE,
      filename: params.filename,
      metadata: params.metadata,
      parentId: params.parentId,
      policyLoad: PolicyLoad.DISABLED,
      source: params.source,
      sourceType: params.sourceType,
      templateId: AGENT_SKILL_TEMPLATE_ID,
      title: params.title,
      updatedAt: now,
    });

    return existing;
  }

  async create(
    agentId: string,
    filename: string,
    content: string,
    params?: {
      editorData?: Record<string, unknown>;
      fileType?: string;
      metadata?: Record<string, unknown>;
      parentId?: string | null;
      policyLoad?: PolicyLoad;
      source?: string;
      sourceType?: typeof SKILL_MANAGEMENT_SOURCE_TYPE;
      templateId?: string;
      title?: string;
    },
  ): Promise<SkillAgentDocument> {
    return this.createWithTx({} as Transaction, agentId, filename, content, params);
  }

  async createWithTx(
    _trx: Transaction,
    agentId: string,
    filename: string,
    content: string,
    params?: {
      editorData?: Record<string, unknown>;
      fileType?: string;
      metadata?: Record<string, unknown>;
      parentId?: string | null;
      policyLoad?: PolicyLoad;
      source?: string;
      sourceType?: typeof SKILL_MANAGEMENT_SOURCE_TYPE;
      templateId?: string;
      title?: string;
    },
  ): Promise<SkillAgentDocument> {
    this.createCalls.push({ agentId, content, filename, params });

    const id = `agent-doc-${this.nextId}`;
    const documentId = `document-${this.nextId}`;
    this.nextId += 1;

    const doc = createAgentDocument({
      agentId,
      content,
      documentId,
      editorData: params?.editorData ?? null,
      fileType: params?.fileType ?? 'agent/document',
      filename,
      id,
      metadata: params?.metadata ?? null,
      parentId: params?.parentId ?? null,
      policyLoad: params?.policyLoad ?? PolicyLoad.PROGRESSIVE,
      source: params?.source ?? null,
      sourceType: params?.sourceType ?? 'agent',
      templateId: params?.templateId ?? null,
      title: params?.title ?? filename,
    });
    this.documents.push(doc);

    return doc;
  }

  async findById(agentDocumentId: string): Promise<SkillAgentDocument | undefined> {
    return this.documents.find((doc) => doc.id === agentDocumentId && !doc.deletedAt);
  }

  async findByDocumentId(
    agentId: string,
    documentId: string,
  ): Promise<SkillAgentDocument | undefined> {
    return this.documents.find(
      (doc) => doc.agentId === agentId && doc.documentId === documentId && !doc.deletedAt,
    );
  }

  async listByParent(agentId: string, parentId: string | null): Promise<SkillAgentDocument[]> {
    return this.documents.filter(
      (doc) => doc.agentId === agentId && doc.parentId === parentId && !doc.deletedAt,
    );
  }

  async listByParentAndFilename(
    agentId: string,
    parentId: string | null,
    filename: string,
  ): Promise<SkillAgentDocument[]> {
    return this.documents.filter(
      (doc) =>
        doc.agentId === agentId &&
        doc.parentId === parentId &&
        doc.filename === filename &&
        !doc.deletedAt,
    );
  }

  async update(
    agentDocumentId: string,
    params?: {
      content?: string;
      editorData?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      policyLoad?: PolicyLoad;
    },
  ): Promise<void> {
    this.updateCalls.push({ agentDocumentId, params });
    const existing = this.documents.find((doc) => doc.id === agentDocumentId);
    if (!existing || !params) return;

    Object.assign(existing, params, { updatedAt: now });
  }

  async updateDocumentIdentity(
    agentDocumentId: string,
    params: {
      filename?: string;
      metadata?: Record<string, unknown>;
      parentId?: string | null;
      title?: string;
    },
  ): Promise<SkillAgentDocument | undefined> {
    this.identityUpdateCalls.push({ agentDocumentId, params });
    const existing = this.documents.find((doc) => doc.id === agentDocumentId);
    if (!existing) return undefined;

    Object.assign(existing, params, { updatedAt: now });
    return existing;
  }
}

export const createAgentDocument = (
  overrides: Partial<SkillAgentDocument> &
    Pick<SkillAgentDocument, 'agentId' | 'documentId' | 'id'>,
): SkillAgentDocument => ({
  accessPublic: 0,
  accessSelf: 0,
  accessShared: 0,
  content: '',
  createdAt: now,
  deletedAt: null,
  deletedByAgentId: null,
  deletedByUserId: null,
  deleteReason: null,
  description: null,
  editorData: null,
  filename: 'document',
  fileType: 'agent/document',
  metadata: null,
  parentId: null,
  policy: null,
  policyLoad: PolicyLoad.PROGRESSIVE,
  policyLoadFormat: DocumentLoadFormat.RAW,
  policyLoadPosition: DocumentLoadPosition.BEFORE_FIRST_USER,
  policyLoadRule: DocumentLoadRule.ALWAYS,
  source: null,
  sourceType: 'agent',
  templateId: null,
  title: 'Document',
  updatedAt: now,
  userId: 'user-1',
  ...overrides,
});

export const createService = () => {
  const agentDocumentModel = new InMemoryAgentDocumentModel();
  const documentService = {
    getDocumentById: vi.fn(async () => ({ updatedAt: backingDocumentUpdatedAt })),
    trySaveCurrentDocumentHistory: vi.fn(async () => ({
      historyId: 'history-exact-1',
      savedAt: now,
    })),
  };
  const service = new SkillManagementDocumentService(
    {
      transaction: async <T>(callback: (trx: Transaction) => Promise<T>) =>
        callback({} as Transaction),
    } as LobeChatDatabase,
    'user-1',
    undefined,
    {
      agentDocumentModel,
      createMarkdownEditorSnapshot: createSnapshot,
      documentService: documentService as unknown as Pick<
        DocumentService,
        'getDocumentById' | 'trySaveCurrentDocumentHistory'
      >,
    },
  );

  return { agentDocumentModel, documentService, service };
};
