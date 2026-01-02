import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeEnv } from '@/envs/knowledge';
import { ChunkingLoader } from '@/libs/langchain';

import { ContentChunk } from './index';

// Mock the dependencies
vi.mock('@/libs/langchain');
vi.mock('@/envs/knowledge', () => ({
  knowledgeEnv: {
    FILE_TYPE_CHUNKING_RULES: '',
    UNSTRUCTURED_API_KEY: 'test-api-key',
    UNSTRUCTURED_SERVER_URL: 'https://test.unstructured.io',
  },
}));

describe('ContentChunk', () => {
  let contentChunk: ContentChunk;
  let mockLangChainPartition: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup LangChain mock
    mockLangChainPartition = vi.fn();
    (ChunkingLoader as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      partitionContent: mockLangChainPartition,
    }));

    contentChunk = new ContentChunk();
  });

  describe('constructor', () => {
    it('should initialize with LangChain client', () => {
      expect(ChunkingLoader).toHaveBeenCalledTimes(1);
    });
  });

  describe('chunkContent', () => {
    const mockFileContent = new Uint8Array([1, 2, 3, 4, 5]);
    const mockFilename = 'test-document.pdf';

    it('should use default langchain service when no rules are configured', async () => {
      const mockLangChainResult = [
        {
          id: 'chunk-1',
          metadata: { source: 'test' },
          pageContent: 'Test content chunk 1',
        },
        {
          id: 'chunk-2',
          metadata: { source: 'test' },
          pageContent: 'Test content chunk 2',
        },
      ];

      mockLangChainPartition.mockResolvedValue(mockLangChainResult);

      const result = await contentChunk.chunkContent({
        content: mockFileContent,
        fileType: 'application/pdf',
        filename: mockFilename,
      });

      expect(mockLangChainPartition).toHaveBeenCalledWith(mockFilename, mockFileContent);
      expect(result.chunks).toHaveLength(2);
      expect(result.chunks[0]).toMatchObject({
        id: 'chunk-1',
        index: 0,
        metadata: { source: 'test' },
        text: 'Test content chunk 1',
        type: 'LangChainElement',
      });
      expect(result.unstructuredChunks).toBeUndefined();
    });

    it('should use langchain when unstructured is not configured', async () => {
      // Temporarily mock env to disable unstructured
      vi.mocked(knowledgeEnv).UNSTRUCTURED_API_KEY = '';

      const mockLangChainResult = [
        {
          id: 'chunk-1',
          metadata: { source: 'test' },
          pageContent: 'LangChain content',
        },
      ];

      mockLangChainPartition.mockResolvedValue(mockLangChainResult);

      const result = await contentChunk.chunkContent({
        content: mockFileContent,
        fileType: 'application/pdf',
        filename: mockFilename,
      });

      expect(mockLangChainPartition).toHaveBeenCalledWith(mockFilename, mockFileContent);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].text).toBe('LangChain content');
      expect(result.unstructuredChunks).toBeUndefined();

      // Restore mock
      vi.mocked(knowledgeEnv).UNSTRUCTURED_API_KEY = 'test-api-key';
    });

    it('should handle langchain results with metadata', async () => {
      const mockLangChainResult = [
        {
          id: 'chunk-1',
          metadata: {
            source: 'test-document.pdf',
            page: 1,
            loc: { lines: { from: 1, to: 10 } },
          },
          pageContent: 'First paragraph content',
        },
        {
          id: 'chunk-2',
          metadata: {
            source: 'test-document.pdf',
            page: 2,
          },
          pageContent: 'Second paragraph content',
        },
      ];

      mockLangChainPartition.mockResolvedValue(mockLangChainResult);

      const result = await contentChunk.chunkContent({
        content: mockFileContent,
        fileType: 'application/pdf',
        filename: mockFilename,
      });

      expect(result.chunks).toHaveLength(2);
      expect(result.chunks[0]).toMatchObject({
        id: 'chunk-1',
        index: 0,
        metadata: {
          source: 'test-document.pdf',
          page: 1,
          loc: { lines: { from: 1, to: 10 } },
        },
        text: 'First paragraph content',
        type: 'LangChainElement',
      });
      expect(result.chunks[1]).toMatchObject({
        id: 'chunk-2',
        index: 1,
        text: 'Second paragraph content',
        type: 'LangChainElement',
      });
    });

    it('should handle different file types', async () => {
      const mockLangChainResult = [
        {
          id: 'docx-chunk-1',
          metadata: { source: 'test.docx' },
          pageContent: 'Word document content',
        },
      ];

      mockLangChainPartition.mockResolvedValue(mockLangChainResult);

      const result = await contentChunk.chunkContent({
        content: mockFileContent,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'test.docx',
      });

      expect(mockLangChainPartition).toHaveBeenCalledWith('test.docx', mockFileContent);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].text).toBe('Word document content');
    });

    it('should throw error when all services fail and its the last service', async () => {
      mockLangChainPartition.mockRejectedValue(new Error('LangChain error'));

      await expect(
        contentChunk.chunkContent({
          content: mockFileContent,
          fileType: 'application/pdf',
          filename: mockFilename,
        }),
      ).rejects.toThrow('LangChain error');
    });

    it('should handle empty langchain results', async () => {
      mockLangChainPartition.mockResolvedValue([]);

      const result = await contentChunk.chunkContent({
        content: mockFileContent,
        fileType: 'application/pdf',
        filename: mockFilename,
      });

      expect(result.chunks).toHaveLength(0);
      expect(result.unstructuredChunks).toBeUndefined();
    });

    it('should extract file extension correctly from MIME type', async () => {
      const mockLangChainResult = [
        {
          id: 'chunk-1',
          metadata: {},
          pageContent: 'Content',
        },
      ];

      mockLangChainPartition.mockResolvedValue(mockLangChainResult);

      await contentChunk.chunkContent({
        content: mockFileContent,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'test.docx',
      });

      expect(mockLangChainPartition).toHaveBeenCalledWith('test.docx', mockFileContent);
    });

    it('should handle langchain results with minimal metadata', async () => {
      const mockLangChainResult = [
        {
          id: 'chunk-minimal',
          metadata: {},
          pageContent: 'Content with no metadata',
        },
      ];

      mockLangChainPartition.mockResolvedValue(mockLangChainResult);

      const result = await contentChunk.chunkContent({
        content: mockFileContent,
        fileType: 'text/plain',
        filename: 'test.txt',
      });

      expect(result.chunks[0]).toMatchObject({
        id: 'chunk-minimal',
        index: 0,
        metadata: {},
        text: 'Content with no metadata',
        type: 'LangChainElement',
      });
    });
  });

  describe('getChunkingServices', () => {
    it('should return default service for unknown file type', () => {
      const services = contentChunk['getChunkingServices']('application/unknown');
      expect(services).toEqual(['default']);
    });

    it('should extract extension from MIME type correctly', () => {
      const services = contentChunk['getChunkingServices']('application/pdf');
      expect(services).toEqual(['default']);
    });

    it('should handle MIME types with multiple slashes', () => {
      const services = contentChunk['getChunkingServices'](
        'application/vnd.openxmlformats-officedocument/wordprocessingml.document',
      );
      expect(services).toEqual(['default']);
    });

    it('should convert extension to lowercase', () => {
      const services = contentChunk['getChunkingServices']('application/PDF');
      expect(services).toEqual(['default']);
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple chunk items with correct indices', async () => {
      const mockLangChainResult = Array.from({ length: 5 }, (_, i) => ({
        id: `chunk-${i}`,
        metadata: { index: i },
        pageContent: `Content ${i}`,
      }));

      mockLangChainPartition.mockResolvedValue(mockLangChainResult);

      const result = await contentChunk.chunkContent({
        content: new Uint8Array([1, 2, 3]),
        fileType: 'text/plain',
        filename: 'test.txt',
      });

      expect(result.chunks).toHaveLength(5);
      result.chunks.forEach((chunk, index) => {
        expect(chunk.index).toBe(index);
        expect(chunk.text).toBe(`Content ${index}`);
      });
    });

    it('should preserve order of chunks from langchain response', async () => {
      const mockLangChainResult = [
        {
          id: 'elem-3',
          metadata: { source: 'test.txt' },
          pageContent: 'Third',
        },
        {
          id: 'elem-1',
          metadata: { source: 'test.txt' },
          pageContent: 'First',
        },
        {
          id: 'elem-2',
          metadata: { source: 'test.txt' },
          pageContent: 'Second',
        },
      ];

      mockLangChainPartition.mockResolvedValue(mockLangChainResult);

      const result = await contentChunk.chunkContent({
        content: new Uint8Array([1, 2, 3]),
        fileType: 'text/plain',
        filename: 'test.txt',
      });

      expect(result.chunks[0].text).toBe('Third');
      expect(result.chunks[1].text).toBe('First');
      expect(result.chunks[2].text).toBe('Second');
      expect(result.chunks[0].index).toBe(0);
      expect(result.chunks[1].index).toBe(1);
      expect(result.chunks[2].index).toBe(2);
    });
  });
});
