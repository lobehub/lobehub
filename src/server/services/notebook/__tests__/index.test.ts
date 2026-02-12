import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

import { NotebookRuntimeService } from '../index';

vi.mock('@/database/models/document');
vi.mock('@/database/models/topicDocument');

describe('NotebookRuntimeService', () => {
  let service: NotebookRuntimeService;
  const mockDb = {} as any;
  const mockUserId = 'test-user';
  let mockDocumentModel: any;
  let mockTopicDocumentModel: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDocumentModel = {
      create: vi.fn(),
      delete: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };

    mockTopicDocumentModel = {
      associate: vi.fn(),
      deleteByDocumentId: vi.fn(),
      findByTopicId: vi.fn(),
    };

    vi.mocked(DocumentModel).mockImplementation(() => mockDocumentModel);
    vi.mocked(TopicDocumentModel).mockImplementation(() => mockTopicDocumentModel);

    service = new NotebookRuntimeService({ serverDB: mockDb, userId: mockUserId });
  });

  const mockDocument = {
    content: '# Hello',
    createdAt: new Date('2025-01-01'),
    description: 'A test doc',
    fileType: 'markdown',
    id: 'doc-1',
    source: 'notebook:topic-1',
    sourceType: 'api' as const,
    title: 'Test Doc',
    totalCharCount: 7,
    totalLineCount: 1,
    updatedAt: new Date('2025-01-01'),
  };

  describe('createDocument', () => {
    it('should create a document and return service result', async () => {
      mockDocumentModel.create.mockResolvedValue(mockDocument);

      const params = {
        content: '# Hello',
        fileType: 'markdown',
        source: 'notebook:topic-1',
        sourceType: 'api' as const,
        title: 'Test Doc',
        totalCharCount: 7,
        totalLineCount: 1,
      };

      const result = await service.createDocument(params);

      expect(mockDocumentModel.create).toHaveBeenCalledWith(params);
      expect(result).toEqual({
        content: '# Hello',
        createdAt: mockDocument.createdAt,
        description: 'A test doc',
        fileType: 'markdown',
        id: 'doc-1',
        source: 'notebook:topic-1',
        sourceType: 'api',
        title: 'Test Doc',
        totalCharCount: 7,
        updatedAt: mockDocument.updatedAt,
      });
    });

    it('should convert topic sourceType to api', async () => {
      mockDocumentModel.create.mockResolvedValue({
        ...mockDocument,
        sourceType: 'topic',
      });

      const result = await service.createDocument({
        content: 'test',
        fileType: 'markdown',
        source: 'test',
        sourceType: 'api',
        title: 'test',
        totalCharCount: 4,
        totalLineCount: 1,
      });

      expect(result.sourceType).toBe('api');
    });
  });

  describe('getDocument', () => {
    it('should return document when found', async () => {
      mockDocumentModel.findById.mockResolvedValue(mockDocument);

      const result = await service.getDocument('doc-1');

      expect(mockDocumentModel.findById).toHaveBeenCalledWith('doc-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('doc-1');
    });

    it('should return undefined when not found', async () => {
      mockDocumentModel.findById.mockResolvedValue(undefined);

      const result = await service.getDocument('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('updateDocument', () => {
    it('should update content and recalculate stats', async () => {
      const newContent = 'line1\nline2\nline3';
      mockDocumentModel.update.mockResolvedValue(undefined);
      mockDocumentModel.findById.mockResolvedValue({
        ...mockDocument,
        content: newContent,
        totalCharCount: newContent.length,
        totalLineCount: 3,
      });

      const result = await service.updateDocument('doc-1', { content: newContent });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', {
        content: newContent,
        totalCharCount: newContent.length,
        totalLineCount: 3,
      });
      expect(result.content).toBe(newContent);
    });

    it('should update title only', async () => {
      mockDocumentModel.update.mockResolvedValue(undefined);
      mockDocumentModel.findById.mockResolvedValue({
        ...mockDocument,
        title: 'New Title',
      });

      const result = await service.updateDocument('doc-1', { title: 'New Title' });

      expect(mockDocumentModel.update).toHaveBeenCalledWith('doc-1', { title: 'New Title' });
      expect(result.title).toBe('New Title');
    });

    it('should throw if document not found after update', async () => {
      mockDocumentModel.update.mockResolvedValue(undefined);
      mockDocumentModel.findById.mockResolvedValue(undefined);

      await expect(service.updateDocument('doc-1', { title: 'x' })).rejects.toThrow(
        'Document not found after update: doc-1',
      );
    });
  });

  describe('deleteDocument', () => {
    it('should delete associations first then the document', async () => {
      mockTopicDocumentModel.deleteByDocumentId.mockResolvedValue(undefined);
      mockDocumentModel.delete.mockResolvedValue(undefined);

      await service.deleteDocument('doc-1');

      expect(mockTopicDocumentModel.deleteByDocumentId).toHaveBeenCalledWith('doc-1');
      expect(mockDocumentModel.delete).toHaveBeenCalledWith('doc-1');
    });
  });

  describe('associateDocumentWithTopic', () => {
    it('should associate document with topic', async () => {
      mockTopicDocumentModel.associate.mockResolvedValue({
        documentId: 'doc-1',
        topicId: 'topic-1',
      });

      await service.associateDocumentWithTopic('doc-1', 'topic-1');

      expect(mockTopicDocumentModel.associate).toHaveBeenCalledWith({
        documentId: 'doc-1',
        topicId: 'topic-1',
      });
    });
  });

  describe('getDocumentsByTopicId', () => {
    it('should return documents for a topic', async () => {
      mockTopicDocumentModel.findByTopicId.mockResolvedValue([mockDocument]);

      const result = await service.getDocumentsByTopicId('topic-1');

      expect(mockTopicDocumentModel.findByTopicId).toHaveBeenCalledWith('topic-1', undefined);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doc-1');
    });

    it('should pass filter to findByTopicId', async () => {
      mockTopicDocumentModel.findByTopicId.mockResolvedValue([]);

      await service.getDocumentsByTopicId('topic-1', { type: 'markdown' });

      expect(mockTopicDocumentModel.findByTopicId).toHaveBeenCalledWith('topic-1', {
        type: 'markdown',
      });
    });
  });
});
