import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database';
import { AgentDocumentModel } from '@/database/models/agentDocuments';

import { AgentDocumentsService } from './index';

vi.mock('@/database/models/agentDocuments', async (importOriginal) => ({
  // Spread the real module so pure helpers (e.g. isEmptyParseShell) keep their
  // production behavior while the model classes stay mocked.
  ...(await importOriginal<any>()),
  AgentDocumentModel: vi.fn(),
  DocumentLoadPosition: {
    BEFORE_FIRST_USER: 'before_first_user',
  },
  buildDocumentFilename: vi.fn(),
  deriveAgentDocumentFields: vi.fn(() => ({})),
}));

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/agentSkill', () => ({ AgentSkillModel: vi.fn() }));
vi.mock('@/database/models/topicDocument', () => ({ TopicDocumentModel: vi.fn() }));
vi.mock('@/database/models/file', () => ({ FileModel: vi.fn() }));
vi.mock('../document', () => ({ DocumentService: vi.fn() }));
vi.mock('../file', () => ({ FileService: vi.fn() }));
vi.mock('../skill/resource', () => ({ SkillResourceService: vi.fn() }));
vi.mock('../agentDocumentVfs', () => ({ AgentDocumentVfsService: vi.fn() }));

const SHELL_DOC_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ROW_ID = 'ae743612-eef4-4c46-879f-9db9c346e760';

const buildModelStub = () => {
  const stub: Record<string, any> = {
    countChildrenByParentIds: vi.fn().mockResolvedValue(new Map()),
    delete: vi.fn(),
    deleteSubtreeByDocumentId: vi.fn(),
    findById: vi.fn(),
    findByDocumentId: vi.fn(),
    updateEditorSnapshotIfUnchanged: vi.fn().mockResolvedValue(true),
  };
  (AgentDocumentModel as any).mockImplementation(function (this: any) {
    Object.assign(this, stub);
  });
  return stub;
};

describe('AgentDocumentsService empty-parse shell tolerance', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';
  let mockModel: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockModel = buildModelStub();
  });

  it('getDocumentSnapshotById exposes a shell as the empty document without re-entering the editor', async () => {
    mockModel.findById = vi.fn().mockResolvedValue({
      agentId: 'agent-1',
      content: '',
      documentId: 'documents-1',
      // Pre-#20914 shell: childless root editorData + empty content. Hydrating
      // this state throws Lexical error #38 and used to make the document
      // unreadable and unremovable (2026-10-16 recurrence).
      editorData: { root: { children: [], type: 'root' } },
      id: SHELL_DOC_ID,
      title: 'VERIFIED-CLONE stub',
    });

    const service = new AgentDocumentsService(db, userId);
    const result = await service.getDocumentSnapshotById(SHELL_DOC_ID, 'agent-1');

    expect(result?.content).toBe('');
    expect(result?.litexml).toContain('<root');
    expect(mockModel.updateEditorSnapshotIfUnchanged).not.toHaveBeenCalled();
  });

  it('removeDocumentById deletes a shell leaf without re-entering the editor', async () => {
    // 2026-10-16 recurrence: pre-#20914 shells threw Lexical error #38 during
    // the remove pre-read and nothing was deleted (attempts=12).
    mockModel.findById = vi.fn().mockResolvedValue({
      agentId: 'agent-1',
      content: '',
      documentId: 'docs_sop',
      editorData: { root: { children: [], type: 'root' } },
      fileType: 'agent/document',
      id: DOC_ROW_ID,
      title: 'VERIFIED-CLONE stub',
    });

    const service = new AgentDocumentsService(db, userId);

    await expect(service.removeDocumentById(DOC_ROW_ID, 'agent-1')).resolves.toBe(true);
    expect(mockModel.delete).toHaveBeenCalledWith(DOC_ROW_ID);
  });
});
