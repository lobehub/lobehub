// @vitest-environment node
import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  PolicyLoad,
} from '@/database/models/agentDocuments';

import type { AgentDocumentEditorSnapshot } from '../agentDocuments/headlessEditor';
import {
  AGENT_SKILL_TEMPLATE_ID,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
  SKILL_INDEX_FILENAME,
  SKILL_MANAGEMENT_SOURCE,
  SKILL_MANAGEMENT_SOURCE_TYPE,
} from './constants';
import type { SkillManagementAgentDocumentModel } from './SkillManagementDocumentService';
import { SkillManagementDocumentService } from './SkillManagementDocumentService';
import type { SkillAgentDocument } from './types';

const now = new Date('2026-05-02T00:00:00.000Z');

const createSnapshot = async (content: string): Promise<AgentDocumentEditorSnapshot> => ({
  content,
  editorData: { markdown: content },
});

class InMemoryAgentDocumentModel implements SkillManagementAgentDocumentModel {
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

const createAgentDocument = (
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

const createService = () => {
  const agentDocumentModel = new InMemoryAgentDocumentModel();
  const documentService = {
    trySaveCurrentDocumentHistory: vi.fn(async () => ({ savedAt: now })),
  };
  const service = new SkillManagementDocumentService(
    {
      transaction: async <T>(callback: (trx: Transaction) => Promise<T>) =>
        callback({} as Transaction),
    } as LobeChatDatabase,
    'user-1',
    {
      agentDocumentModel,
      createMarkdownEditorSnapshot: createSnapshot,
      documentService,
    },
  );

  return { agentDocumentModel, documentService, service };
};

const skillContent = (name: string, description: string, body = '# Skill') =>
  `---\ndescription: ${description}\nname: ${name}\n---\n${body}`;

const skillBody = (body = '# Skill') => body;

describe('SkillManagementDocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates, lists, and gets managed skills without leaking list content', async () => {
    const { agentDocumentModel, service } = createService();

    await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Writes release notes',
      name: 'release-writer',
      title: 'Release Writer',
    });
    await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Reviews changes',
      name: 'code-reviewer',
      title: 'Code Reviewer',
    });

    const list = await service.listSkills({ agentId: 'agent-1' });
    expect(list.map((item) => item.name)).toEqual(['code-reviewer', 'release-writer']);
    expect(list[0]).not.toHaveProperty('content');
    expect(agentDocumentModel.createCalls[0]).toEqual(
      expect.objectContaining({
        content: '',
        filename: 'release-writer',
        params: expect.objectContaining({
          fileType: SKILL_BUNDLE_FILE_TYPE,
          policyLoad: PolicyLoad.DISABLED,
          source: SKILL_MANAGEMENT_SOURCE,
          sourceType: SKILL_MANAGEMENT_SOURCE_TYPE,
          templateId: AGENT_SKILL_TEMPLATE_ID,
        }),
      }),
    );

    const detail = await service.getSkill({
      agentId: 'agent-1',
      includeContent: true,
      name: 'release-writer',
    });

    expect(detail).toEqual(
      expect.objectContaining({
        content: skillContent('release-writer', 'Writes release notes'),
        frontmatter: { description: 'Writes release notes', name: 'release-writer' },
        name: 'release-writer',
      }),
    );
    expect(detail?.bundle.agentDocumentId).toBe('agent-doc-1');
    expect(detail?.bundle.documentId).toBe('document-1');
    expect(detail?.index.agentDocumentId).toBe('agent-doc-2');
    expect(detail?.index.documentId).toBe('document-2');
  });

  it('converts a hinted source document into the index while preserving ids', async () => {
    const { agentDocumentModel, service } = createService();
    const source = await agentDocumentModel.create('agent-1', 'draft-skill', '# Draft', {
      metadata: { agentSignal: { hintIsSkill: true } },
      title: 'Draft Skill',
    });

    const detail = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody('# Draft'),
      description: 'Draft helper',
      name: 'draft-skill',
      sourceAgentDocumentId: source.id,
      title: 'Draft Skill',
    });

    expect(detail.index.agentDocumentId).toBe(source.id);
    expect(detail.index.documentId).toBe(source.documentId);
    expect(detail.content).toBe(skillContent('draft-skill', 'Draft helper', '# Draft'));
    expect(agentDocumentModel.documents).toHaveLength(2);
    expect(agentDocumentModel.documents.find((doc) => doc.id === source.id)).toEqual(
      expect.objectContaining({
        fileType: SKILL_INDEX_FILE_TYPE,
        filename: SKILL_INDEX_FILENAME,
        parentId: detail.bundle.documentId,
        policyLoad: PolicyLoad.DISABLED,
        source: SKILL_MANAGEMENT_SOURCE,
        sourceType: SKILL_MANAGEMENT_SOURCE_TYPE,
      }),
    );
  });

  it('rejects duplicate skill names before creating another bundle', async () => {
    const { agentDocumentModel, service } = createService();
    await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Review helper',
      name: 'review-skill',
      title: 'Review Skill',
    });
    agentDocumentModel.createCalls = [];

    await expect(
      service.createSkill({
        agentId: 'agent-1',
        bodyMarkdown: skillBody(),
        description: 'Review helper',
        name: 'review-skill',
        title: 'Review Skill',
      }),
    ).rejects.toThrow('Skill already exists');

    expect(agentDocumentModel.createCalls).toEqual([]);
  });

  it('does not create a bundle when source document conversion cannot start', async () => {
    const { agentDocumentModel, service } = createService();

    await expect(
      service.createSkill({
        agentId: 'agent-1',
        bodyMarkdown: skillBody(),
        description: 'Missing source',
        name: 'missing-skill',
        sourceAgentDocumentId: 'missing-source',
        title: 'Missing Skill',
      }),
    ).rejects.toThrow('Source agent document not found: missing-source');

    expect(agentDocumentModel.createCalls).toEqual([]);
    expect(await service.listSkills({ agentId: 'agent-1' })).toEqual([]);
  });

  it('rejects source documents owned by another agent before creating a bundle', async () => {
    const { agentDocumentModel, service } = createService();
    const otherAgentSource = await agentDocumentModel.create('agent-2', 'draft-skill', '# Draft', {
      metadata: { agentSignal: { hintIsSkill: true } },
      title: 'Draft Skill',
    });

    await expect(
      service.createSkill({
        agentId: 'agent-1',
        bodyMarkdown: skillBody(),
        description: 'Draft helper',
        name: 'draft-skill',
        sourceAgentDocumentId: otherAgentSource.id,
        title: 'Draft Skill',
      }),
    ).rejects.toThrow('Source agent document does not belong to agent agent-1');

    expect(agentDocumentModel.createCalls).toHaveLength(1);
    expect(await service.listSkills({ agentId: 'agent-1' })).toEqual([]);
  });

  it('replaces the skill index and saves history with the backing document id', async () => {
    const { agentDocumentModel, documentService, service } = createService();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Researches APIs',
      name: 'researcher',
      title: 'Researcher',
    });

    const detail = await service.replaceSkillIndex({
      agentId: 'agent-1',
      bodyMarkdown: skillBody('# Better'),
      description: 'Researches docs better',
      name: 'researcher',
    });

    expect(documentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
      created.index.documentId,
      'llm_call',
    );
    expect(detail?.content).toBe(skillContent('researcher', 'Researches docs better', '# Better'));
    expect(detail?.frontmatter).toEqual({
      description: 'Researches docs better',
      name: 'researcher',
    });
    expect(agentDocumentModel.updateCalls.at(-1)).toEqual(
      expect.objectContaining({
        agentDocumentId: created.index.agentDocumentId,
        params: expect.objectContaining({
          metadata: {
            skill: { frontmatter: { description: 'Researches docs better', name: 'researcher' } },
          },
          policyLoad: PolicyLoad.DISABLED,
        }),
      }),
    );
    expect(agentDocumentModel.identityUpdateCalls.at(-1)).toEqual(
      expect.objectContaining({
        agentDocumentId: created.bundle.agentDocumentId,
        params: {
          metadata: {
            skill: { frontmatter: { description: 'Researches docs better', name: 'researcher' } },
          },
        },
      }),
    );
  });

  it('resolves a target skill from either the bundle or index agent document id', async () => {
    const { service } = createService();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Portable lookup',
      name: 'portable-skill',
      title: 'Portable Skill',
    });

    await expect(
      service.getSkill({
        agentDocumentId: created.index.agentDocumentId,
        agentId: 'agent-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        bundle: created.bundle,
        index: created.index,
        name: 'portable-skill',
      }),
    );
  });

  it('renames bundle identity and synchronizes index frontmatter content', async () => {
    const { agentDocumentModel, documentService, service } = createService();
    const created = await service.createSkill({
      agentId: 'agent-1',
      bodyMarkdown: skillBody(),
      description: 'Old description',
      name: 'old-skill',
      title: 'Old Skill',
    });

    const detail = await service.renameSkill({
      agentDocumentId: created.bundle.agentDocumentId,
      agentId: 'agent-1',
      newName: 'new-skill',
      newTitle: 'New Skill',
    });

    expect(detail).toEqual(
      expect.objectContaining({
        content: skillContent('new-skill', 'Old description'),
        frontmatter: { description: 'Old description', name: 'new-skill' },
        name: 'new-skill',
        title: 'New Skill',
      }),
    );
    expect(agentDocumentModel.identityUpdateCalls).toEqual([
      expect.objectContaining({
        agentDocumentId: created.bundle.agentDocumentId,
        params: expect.objectContaining({
          filename: 'new-skill',
          title: 'New Skill',
        }),
      }),
      expect.objectContaining({
        agentDocumentId: created.index.agentDocumentId,
        params: expect.objectContaining({
          filename: SKILL_INDEX_FILENAME,
          title: SKILL_INDEX_FILENAME,
        }),
      }),
    ]);
    expect(documentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
      created.index.documentId,
      'llm_call',
    );
  });

  it('throws loudly when a bundle has no matching index document', async () => {
    const { agentDocumentModel, service } = createService();
    await agentDocumentModel.create('agent-1', 'broken-skill', '', {
      fileType: SKILL_BUNDLE_FILE_TYPE,
      title: 'Broken Skill',
    });

    await expect(service.listSkills({ agentId: 'agent-1' })).rejects.toThrow(
      'expected one SKILL.md index, found 0',
    );
  });

  it('throws loudly when a bundle has multiple matching index documents', async () => {
    const { agentDocumentModel, service } = createService();
    const bundle = await agentDocumentModel.create('agent-1', 'broken-skill', '', {
      fileType: SKILL_BUNDLE_FILE_TYPE,
      title: 'Broken Skill',
    });

    await agentDocumentModel.create(
      'agent-1',
      SKILL_INDEX_FILENAME,
      skillContent('broken-skill', 'One'),
      {
        fileType: SKILL_INDEX_FILE_TYPE,
        parentId: bundle.documentId,
      },
    );
    await agentDocumentModel.create(
      'agent-1',
      SKILL_INDEX_FILENAME,
      skillContent('broken-skill', 'Two'),
      {
        fileType: SKILL_INDEX_FILE_TYPE,
        parentId: bundle.documentId,
      },
    );

    await expect(service.getSkill({ agentId: 'agent-1', name: 'broken-skill' })).rejects.toThrow(
      'expected one SKILL.md index, found 2',
    );
  });

  it('throws loudly when duplicate root bundles share the same skill name', async () => {
    const { agentDocumentModel, service } = createService();
    const firstBundle = await agentDocumentModel.create('agent-1', 'duplicate-skill', '', {
      fileType: SKILL_BUNDLE_FILE_TYPE,
      title: 'Duplicate Skill',
    });
    const secondBundle = await agentDocumentModel.create('agent-1', 'duplicate-skill', '', {
      fileType: SKILL_BUNDLE_FILE_TYPE,
      title: 'Duplicate Skill Copy',
    });

    await agentDocumentModel.create(
      'agent-1',
      SKILL_INDEX_FILENAME,
      skillContent('duplicate-skill', 'One'),
      {
        fileType: SKILL_INDEX_FILE_TYPE,
        parentId: firstBundle.documentId,
      },
    );
    await agentDocumentModel.create(
      'agent-1',
      SKILL_INDEX_FILENAME,
      skillContent('duplicate-skill', 'Two'),
      {
        fileType: SKILL_INDEX_FILE_TYPE,
        parentId: secondBundle.documentId,
      },
    );

    await expect(service.listSkills({ agentId: 'agent-1' })).rejects.toThrow(
      'duplicate bundle names duplicate-skill',
    );
  });
});
