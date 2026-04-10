import { describe, expect, it, vi } from 'vitest';

import type { FileListItem } from '@/types/files';

import { resourceService } from './index';

const { mockUpdateDocument, mockGetKnowledgeItem, mockUpdateFile } = vi.hoisted(() => ({
  mockGetKnowledgeItem: vi.fn(),
  mockUpdateDocument: vi.fn(),
  mockUpdateFile: vi.fn(),
}));

vi.mock('../document', () => ({
  documentService: {
    updateDocument: mockUpdateDocument,
  },
}));

vi.mock('../file', () => ({
  fileService: {
    getKnowledgeItem: mockGetKnowledgeItem,
    updateFile: mockUpdateFile,
  },
}));

const createKnowledgeItem = (overrides: Partial<FileListItem> = {}): FileListItem => ({
  chunkCount: null,
  chunkingError: null,
  chunkingStatus: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  embeddingError: null,
  embeddingStatus: null,
  fileType: 'text/plain',
  finishEmbedding: false,
  id: 'resource-1',
  name: 'Resource 1',
  size: 1,
  sourceType: 'file',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  url: 'https://example.com/resource-1',
  ...overrides,
});

describe('resourceService.updateResource', () => {
  it('routes raw file ids through fileService.updateFile', async () => {
    mockGetKnowledgeItem
      .mockResolvedValueOnce(createKnowledgeItem({ id: 'file-1', sourceType: 'file' }))
      .mockResolvedValueOnce(
        createKnowledgeItem({
          id: 'file-1',
          name: 'Renamed file',
          parentId: 'folder-2',
          sourceType: 'file',
        }),
      );

    const result = await resourceService.updateResource('file-1', {
      name: 'Renamed file',
      parentId: 'folder-2',
    });

    expect(mockUpdateFile).toHaveBeenCalledWith('file-1', {
      metadata: undefined,
      name: 'Renamed file',
      parentId: 'folder-2',
    });
    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(result.name).toBe('Renamed file');
    expect(result.parentId).toBe('folder-2');
  });

  it('keeps document updates on documentService.updateDocument', async () => {
    mockGetKnowledgeItem
      .mockResolvedValueOnce(
        createKnowledgeItem({
          fileType: 'custom/document',
          id: 'docs_1',
          sourceType: 'document',
        }),
      )
      .mockResolvedValueOnce(
        createKnowledgeItem({
          fileType: 'custom/document',
          id: 'docs_1',
          name: 'Updated title',
          sourceType: 'document',
        }),
      );

    await resourceService.updateResource('docs_1', {
      editorData: { type: 'doc' },
      name: 'Updated title',
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      content: undefined,
      editorData: JSON.stringify({ type: 'doc' }),
      id: 'docs_1',
      metadata: undefined,
      parentId: undefined,
      title: 'Updated title',
    });
  });
});
