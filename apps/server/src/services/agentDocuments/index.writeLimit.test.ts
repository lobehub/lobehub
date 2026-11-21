// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkDocumentCharLimit } from '@/business/server/document/writeLimit';
import { AgentDocumentModel } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';

import { DocumentService } from '../document';
import { AgentDocumentsService } from './index';

const { writePageBodyThroughRoom } = vi.hoisted(() => ({ writePageBodyThroughRoom: vi.fn() }));

vi.mock('@/business/server/document/writeLimit', () => ({ checkDocumentCharLimit: vi.fn() }));
vi.mock('../pageCollab/bodyWriter', () => ({ writePageBodyThroughRoom }));

vi.mock('@/database/models/agentDocuments', () => ({
  AgentDocumentModel: vi.fn(),
  DocumentLoadPosition: { BEFORE_FIRST_USER: 'before_first_user' },
  buildDocumentFilename: vi.fn((title: string) => title),
  deriveAgentDocumentFields: vi.fn(() => ({})),
  extractMarkdownH1Title: vi.fn((content: string) => ({ content })),
}));
vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/agentSkill', () => ({ AgentSkillModel: vi.fn() }));
vi.mock('@/database/models/topicDocument', () => ({ TopicDocumentModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('../document', () => ({ DocumentService: vi.fn() }));
vi.mock('../file', () => ({ FileService: vi.fn() }));
vi.mock('../skill/resource', () => ({ SkillResourceService: vi.fn() }));

vi.mock('@lobehub/editor/headless', () => ({
  DEFAULT_HEADLESS_EDITOR_PLUGINS: [],
  createHeadlessEditor: vi.fn(() => {
    let markdown = '';
    return {
      destroy: vi.fn(),
      export: vi.fn(() => ({ editorData: { root: { children: [] } }, markdown })),
      hydrateEditorData: vi.fn(),
      hydrateMarkdown: vi.fn((content: string) => {
        markdown = content;
      }),
    };
  }),
}));

const check = vi.mocked(checkDocumentCharLimit);

describe('AgentDocumentsService per-document character limit', () => {
  const doc = {
    agentId: 'agent-1',
    content: 'x'.repeat(20),
    documentId: 'documents-1',
    id: 'agent-doc-1',
    title: 'Doc',
  };
  const model = {
    copy: vi.fn(),
    create: vi.fn(),
    findByFilename: vi.fn(),
    findByParentAndFilename: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  };
  const documentService = { trySaveCurrentDocumentHistory: vi.fn() };
  const service = () => new AgentDocumentsService({} as LobeChatDatabase, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentDocumentModel as any).mockImplementation(function () {
      return model;
    });
    (DocumentService as any).mockImplementation(function () {
      return documentService;
    });
    check.mockResolvedValue({ allowed: false, limit: 10, plan: 'free' });
    writePageBodyThroughRoom.mockResolvedValue(false);
    model.findById.mockResolvedValue(doc);
    model.findByFilename.mockResolvedValue(doc);
    model.findByParentAndFilename.mockResolvedValue(undefined);
  });

  it('refuses an agent createDocument over the limit before persisting', async () => {
    await expect(service().createDocument('agent-1', 'Doc', 'x'.repeat(50))).rejects.toMatchObject({
      cause: { data: { code: 'DocumentCharLimitExceeded', limit: 10 } },
    });

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ charCount: 50, source: 'agent', userId: 'user-1' }),
    );
    expect(model.create).not.toHaveBeenCalled();
  });

  it('refuses an agent full rewrite of a page without a live room, leaving no row write', async () => {
    await expect(
      service().replaceDocumentContentById('agent-doc-1', 'x'.repeat(50), 'agent-1'),
    ).rejects.toMatchObject({ cause: { data: { code: 'DocumentCharLimitExceeded' } } });

    expect(writePageBodyThroughRoom).toHaveBeenCalledWith(
      expect.anything(),
      'documents-1',
      expect.anything(),
      expect.objectContaining({ writeSource: 'agent' }),
    );
    expect(documentService.trySaveCurrentDocumentHistory).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });

  it('allows an agent rewrite that shrinks an over-limit document', async () => {
    await service().replaceDocumentContentById('agent-doc-1', 'x'.repeat(15), 'agent-1');

    expect(model.update).toHaveBeenCalled();
  });

  it('checks a user upsert against the stored length and refuses growth', async () => {
    await expect(
      service().upsertDocument({ agentId: 'agent-1', content: 'x'.repeat(50), filename: 'a.md' }),
    ).rejects.toMatchObject({ cause: { data: { code: 'DocumentCharLimitExceeded' } } });

    expect(check).toHaveBeenCalledWith(expect.objectContaining({ source: 'user' }));
    expect(model.upsert).not.toHaveBeenCalled();
  });

  it('exempts system upserts (templates, clones) and onboarding upserts by filename', async () => {
    await service().upsertDocument({
      agentId: 'agent-1',
      content: 'x'.repeat(50),
      filename: 'a.md',
      source: 'system',
    });
    await service().upsertDocumentByFilename({
      agentId: 'agent-1',
      content: 'x'.repeat(50),
      filename: 'a.md',
    });

    expect(check).not.toHaveBeenCalled();
    expect(model.upsert).toHaveBeenCalledTimes(2);
  });

  it('exempts copyDocumentById', async () => {
    await service().copyDocumentById('agent-doc-1', undefined, 'agent-1');

    expect(check).not.toHaveBeenCalled();
    expect(model.copy).toHaveBeenCalled();
  });
});
