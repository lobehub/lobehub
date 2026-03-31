// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentDocumentModel, buildDocumentFilename } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';

import { AgentDocumentsService } from './agentDocuments';

vi.mock('@/database/models/agentDocuments', () => ({
  AgentDocumentModel: vi.fn(),
  DocumentLoadPosition: {
    BEFORE_FIRST_USER: 'before_first_user',
  },
  buildDocumentFilename: vi.fn(),
}));

describe('AgentDocumentsService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockModel = {
    create: vi.fn(),
    findByAgent: vi.fn(),
    findByFilename: vi.fn(),
    hasByAgent: vi.fn(),
    upsert: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (AgentDocumentModel as any).mockImplementation(() => mockModel);
    vi.mocked(buildDocumentFilename).mockImplementation((title: string) => `${title}.md`);
  });

  describe('createDocument', () => {
    it('should append a numeric suffix when the base filename already exists', async () => {
      mockModel.findByFilename
        .mockResolvedValueOnce({ id: 'existing-doc' })
        .mockResolvedValueOnce(undefined);
      mockModel.create.mockResolvedValue({ id: 'new-doc', filename: 'note-2.md' });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.createDocument('agent-1', 'note', 'content');

      expect(mockModel.findByFilename).toHaveBeenNthCalledWith(1, 'agent-1', 'note.md');
      expect(mockModel.findByFilename).toHaveBeenNthCalledWith(2, 'agent-1', 'note-2.md');
      expect(mockModel.create).toHaveBeenCalledWith(
        'agent-1',
        'note-2.md',
        'content',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(result).toEqual({ id: 'new-doc', filename: 'note-2.md' });
    });

    it('should throw after too many filename collisions', async () => {
      mockModel.findByFilename.mockResolvedValue({ id: 'existing-doc' });

      const service = new AgentDocumentsService(db, userId);

      await expect(service.createDocument('agent-1', 'note', 'content')).rejects.toThrow(
        'Unable to generate a unique filename for "note" after 1000 attempts.',
      );
      expect(mockModel.create).not.toHaveBeenCalled();
    });
  });

  describe('listDocuments', () => {
    it('should return a list of documents with filename, id, and title', async () => {
      mockModel.findByAgent.mockResolvedValue([
        { content: 'c1', filename: 'a.md', id: 'doc-1', policy: null, title: 'A' },
        { content: 'c2', filename: 'b.md', id: 'doc-2', policy: null, title: 'B' },
      ]);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.listDocuments('agent-1');

      expect(mockModel.findByAgent).toHaveBeenCalledWith('agent-1');
      expect(result).toEqual([
        { filename: 'a.md', id: 'doc-1', loadPosition: undefined, title: 'A' },
        { filename: 'b.md', id: 'doc-2', loadPosition: undefined, title: 'B' },
      ]);
    });
  });

  describe('getDocumentByFilename', () => {
    it('should read a document by filename', async () => {
      mockModel.findByFilename.mockResolvedValue({
        content: 'hello',
        filename: 'note.md',
        id: 'doc-1',
        title: 'note',
      });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.getDocumentByFilename('agent-1', 'note.md');

      expect(mockModel.findByFilename).toHaveBeenCalledWith('agent-1', 'note.md');
      expect(result).toEqual({
        content: 'hello',
        filename: 'note.md',
        id: 'doc-1',
        title: 'note',
      });
    });

    it('should return undefined when filename does not exist', async () => {
      mockModel.findByFilename.mockResolvedValue(undefined);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.getDocumentByFilename('agent-1', 'missing.md');

      expect(result).toBeUndefined();
    });
  });

  describe('upsertDocumentByFilename', () => {
    it('should create or update a document by filename', async () => {
      mockModel.upsert.mockResolvedValue({ content: 'new', filename: 'f.md', id: 'doc-1' });

      const service = new AgentDocumentsService(db, userId);
      const result = await service.upsertDocumentByFilename({
        agentId: 'agent-1',
        content: 'new',
        filename: 'f.md',
      });

      expect(mockModel.upsert).toHaveBeenCalledWith('agent-1', 'f.md', 'new');
      expect(result).toEqual({ content: 'new', filename: 'f.md', id: 'doc-1' });
    });
  });

  describe('hasDocuments', () => {
    it('should use the model existence check', async () => {
      mockModel.hasByAgent.mockResolvedValue(true);

      const service = new AgentDocumentsService(db, userId);
      const result = await service.hasDocuments('agent-1');

      expect(mockModel.hasByAgent).toHaveBeenCalledWith('agent-1');
      expect(result).toBe(true);
    });
  });
});
