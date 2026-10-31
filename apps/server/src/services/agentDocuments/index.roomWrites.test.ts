// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentModel } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';

import { DocumentService } from '../document';
import { AgentDocumentsService } from './index';

const { writePageBodyThroughRoom } = vi.hoisted(() => ({ writePageBodyThroughRoom: vi.fn() }));

vi.mock('../pageCollab/bodyWriter', () => ({ writePageBodyThroughRoom }));

vi.mock('@/database/models/agentDocuments', () => ({
  AgentDocumentModel: vi.fn(),
  DocumentLoadPosition: { BEFORE_FIRST_USER: 'before_first_user' },
  buildDocumentFilename: vi.fn(),
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

describe('AgentDocumentsService writes to a document in a live room', () => {
  const doc = {
    agentId: 'agent-1',
    content: 'old',
    documentId: 'documents-1',
    id: 'agent-doc-1',
    title: 'Doc',
  };
  const model = {
    findByFilename: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  };
  const documentService = { trySaveCurrentDocumentHistory: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentDocumentModel as any).mockImplementation(function () {
      return model;
    });
    (DocumentService as any).mockImplementation(function () {
      return documentService;
    });
    model.findById.mockResolvedValue(doc);
    model.findByFilename.mockResolvedValue(doc);
  });

  it('puts a full rewrite into the room instead of the row', async () => {
    writePageBodyThroughRoom.mockResolvedValue(true);

    await new AgentDocumentsService({} as LobeChatDatabase, 'user-1').replaceDocumentContentById(
      'agent-doc-1',
      'new',
      'agent-1',
    );

    expect(writePageBodyThroughRoom).toHaveBeenCalledWith(
      {},
      'documents-1',
      expect.objectContaining({ markdown: 'new' }),
      expect.objectContaining({ saveSource: 'llm_call', userId: 'user-1' }),
    );
    expect(model.update).not.toHaveBeenCalled();
    // The room records the AI version itself.
    expect(documentService.trySaveCurrentDocumentHistory).not.toHaveBeenCalled();
  });

  it('writes the row as before when the document has no live room', async () => {
    writePageBodyThroughRoom.mockResolvedValue(false);

    await new AgentDocumentsService({} as LobeChatDatabase, 'user-1').replaceDocumentContentById(
      'agent-doc-1',
      'new',
      'agent-1',
    );

    expect(documentService.trySaveCurrentDocumentHistory).toHaveBeenCalledWith(
      'documents-1',
      'llm_call',
    );
    expect(model.update).toHaveBeenCalledWith('agent-doc-1', expect.objectContaining({}));
  });

  it('puts an upsert of an existing document into the room', async () => {
    writePageBodyThroughRoom.mockResolvedValue(true);

    await new AgentDocumentsService({} as LobeChatDatabase, 'user-1').upsertDocumentByFilename({
      agentId: 'agent-1',
      content: 'new',
      filename: 'doc.md',
    });

    expect(model.upsert).not.toHaveBeenCalled();
  });
});
