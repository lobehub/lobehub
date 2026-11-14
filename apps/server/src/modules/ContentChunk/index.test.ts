import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeEnv } from '@/envs/knowledge';
import { ChunkingLoader } from '@/libs/document-loaders';

import { ContentChunk } from './index';

// Mock the dependencies
vi.mock('@/libs/document-loaders');
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
    (ChunkingLoader as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        partitionContent: mockLangChainPartition,
      };
    });

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
        type: 'DocumentChunk',
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
        type: 'DocumentChunk',
      });
      expect(result.chunks[1]).toMatchObject({
        id: 'chunk-2',
        index: 1,
        text: 'Second paragraph content',
        type: 'DocumentChunk',
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
        type: 'DocumentChunk',
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

describe('PDF binary chunking regression', () => {
  // Chromium-generated one-page image-only PDF, SHA-256:
  // eba929539a6386cef524243349a225ebe8afb341f1fb6687489fb66e92be8d5b
  const imageOnlyPdf = Buffer.from(
    [
      'JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PC9UaXRsZSAoaW1hZ2Utb25seS5odG1sKQovQ3JlYXRvciAoTW96aWxsYS81LjAg',
      'XChYMTE7IExpbnV4IHg4Nl82NFwpIEFwcGxlV2ViS2l0LzUzNy4zNiBcKEtIVE1MLCBsaWtlIEdlY2tvXCkgSGVhZGxlc3ND',
      'aHJvbWUvMTU2LjAuMC4wIFNhZmFyaS81MzcuMzYpCi9Qcm9kdWNlciAoU2tpYS9QREYgbTE1NikKL0NyZWF0aW9uRGF0ZSAo',
      'RDoyMDI2MTExMTExMjkyMSswMCcwMCcpCi9Nb2REYXRlIChEOjIwMjYxMTExMTEyOTIxKzAwJzAwJyk+PgplbmRvYmoKMyAw',
      'IG9iago8PC9jYSAxCi9CTSAvTm9ybWFsPj4KZW5kb2JqCjQgMCBvYmoKPDwvRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3Ro',
      'IDMwNDI+PiBzdHJlYW0KeJxlWcuuHLcR3c9XcB0gdD1ZLMDwInIiZOGFvckHCI4SQApgBfn/4JDNx9j2xWhu3WY3m6w6j2IV',
      'zfFfoULlz/X6NVLKp6+v314SXsSiphFLESIq4sQ1kr18+/X1jz+V/7x+e2ll6eydx63wW4iml/fhn76+uOD/Xz6W+eXb59d3',
      'H7V8/u/ru7/9+/P/vv1avv/+u58+/P3HQuWHH/7y44cX7teMSifC8/75qtFNy/35y8fyx+C3zy+ngh/B4GeslPmDIev7vJKD',
      'iikVbs+lqqrl/sSYPwTnYGE86hosrUW5P8cDfx98BjsV82twjNtfn+MFfx/89vlljYp1Kl+fb4J1dy3mWdOic7FuVVzxzbN2',
      'U0OsVY0evXx6IRqahGivThp9XOld3Isl1SaWNmIaRlIspYaJ+DOam1sUS6vdczy71ySnLJatZpDNmKekFsusFJZzdK/SKVpB',
      'QnEk7uNRk4O5OGmVcPIRcxKy4uRVG4eM0VGpt+zFKapZ1yzmrTahjOKU1UWbjBiTkRZnrt7DxmDHVy7OWpsz4629EmdHzGsQ',
      'jydbNRLO4hw1NMZQRYI1XJc1QhLXaWUO0+KC0hDD/aQaUYviojXSPcdorq1r4kqvkb1jdagmd2vFJWp0lRFiMunFJWvYs1mW',
      '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',
      'Ci9SZXNvdXJjZXMgPDwvUHJvY1NldCBbL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSV0KL0V4dEdTdGF0ZSA8',
      'PC9HMyAzIDAgUj4+Pj4KL01lZGlhQm94IFswIDAgNjEyIDc5Ml0KL0NvbnRlbnRzIDQgMCBSCi9TdHJ1Y3RQYXJlbnRzIDAK',
      'L1RhYnMgL1MKL1BhcmVudCA1IDAgUj4+CmVuZG9iago1IDAgb2JqCjw8L1R5cGUgL1BhZ2VzCi9Db3VudCAxCi9LaWRzIFsy',
      'IDAgUl0+PgplbmRvYmoKOSAwIG9iago8PC9UeXBlIC9TdHJ1Y3RFbGVtCi9TIC9GaWd1cmUKL1AgOCAwIFIKL1BnIDIgMCBS',
      'Ci9LIDA+PgplbmRvYmoKOCAwIG9iago8PC9UeXBlIC9TdHJ1Y3RFbGVtCi9TIC9Ob25TdHJ1Y3QKL1AgNyAwIFIKL0sgOSAw',
      'IFI+PgplbmRvYmoKNyAwIG9iago8PC9UeXBlIC9TdHJ1Y3RFbGVtCi9TIC9Eb2N1bWVudAovTGFuZyAoZW4tVVMpCi9QIDYg',
      'MCBSCi9LIDggMCBSPj4KZW5kb2JqCjEwIDAgb2JqCls5IDAgUl0KZW5kb2JqCjExIDAgb2JqCjw8L1R5cGUgL1BhcmVudFRy',
      'ZWUKL051bXMgWzAgMTAgMCBSXT4+CmVuZG9iago2IDAgb2JqCjw8L1R5cGUgL1N0cnVjdFRyZWVSb290Ci9LIDcgMCBSCi9Q',
      'YXJlbnRUcmVlTmV4dEtleSAxCi9QYXJlbnRUcmVlIDExIDAgUj4+CmVuZG9iagoxMiAwIG9iago8PC9UeXBlIC9DYXRhbG9n',
      'Ci9QYWdlcyA1IDAgUgovTWFya0luZm8gPDwvVHlwZSAvTWFya0luZm8KL01hcmtlZCB0cnVlPj4KL1N0cnVjdFRyZWVSb290',
      'IDYgMCBSCi9WaWV3ZXJQcmVmZXJlbmNlcyA8PC9UeXBlIC9WaWV3ZXJQcmVmZXJlbmNlcwovRGlzcGxheURvY1RpdGxlIHRy',
      'dWU+PgovTGFuZyAoZW4tVVMpPj4KZW5kb2JqCnhyZWYKMCAxMwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAw',
      'MDAgbiAKMDAwMDAwMzQzNSAwMDAwMCBuIAowMDAwMDAwMjg1IDAwMDAwIG4gCjAwMDAwMDAzMjIgMDAwMDAgbiAKMDAwMDAw',
      'MzYzMiAwMDAwMCBuIAowMDAwMDAzOTg5IDAwMDAwIG4gCjAwMDAwMDM4MjggMDAwMDAgbiAKMDAwMDAwMzc1OSAwMDAwMCBu',
      'IAowMDAwMDAzNjg3IDAwMDAwIG4gCjAwMDAwMDM5MTAgMDAwMDAgbiAKMDAwMDAwMzkzNCAwMDAwMCBuIAowMDAwMDA0MDc5',
      'IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSAxMwovUm9vdCAxMiAwIFIKL0luZm8gMSAwIFI+PgpzdGFydHhyZWYKNDI3Ngol',
      'JUVPRgo=',
    ].join(''),
    'base64',
  );

  it('returns no chunks for a valid image-only PDF across repeated pooled reads', async () => {
    const { ChunkingLoader: RealChunkingLoader } = await vi.importActual<{
      ChunkingLoader: typeof ChunkingLoader;
    }>('@/libs/document-loaders');
    const loader = new RealChunkingLoader();

    // Move past the start of the Node Buffer pool: old PDF.js loses byteOffset
    // when constructing substreams, even though the input bytes are unchanged.
    Buffer.allocUnsafe(1024).fill(0x78);
    for (let i = 0; i < 3; i++) {
      await expect(loader.partitionContent('scan.pdf', imageOnlyPdf)).resolves.toEqual([]);
    }
  });

  it('keeps text when parsing a PDF repeatedly after an image-only document', async () => {
    const { ChunkingLoader: RealChunkingLoader } = await vi.importActual<{
      ChunkingLoader: typeof ChunkingLoader;
    }>('@/libs/document-loaders');
    const loader = new RealChunkingLoader();
    const textPdf = await readFile(
      new URL(
        '../../../../../packages/file-loaders/src/loaders/pdf/fixtures/test.pdf',
        import.meta.url,
      ),
    );

    await expect(loader.partitionContent('scan.pdf', imageOnlyPdf)).resolves.toEqual([]);
    for (let i = 0; i < 2; i++) {
      const chunks = await loader.partitionContent('report.pdf', textPdf);
      expect(chunks.map((chunk) => chunk.pageContent).join('\n')).toContain('简单报告');
    }
  });

  it('still rejects malformed PDFs as loader errors', async () => {
    const { ChunkingLoader: RealChunkingLoader } = await vi.importActual<{
      ChunkingLoader: typeof ChunkingLoader;
    }>('@/libs/document-loaders');

    await expect(
      new RealChunkingLoader().partitionContent('broken.pdf', Buffer.from('%PDF-1.4\ninvalid')),
    ).rejects.toMatchObject({ name: 'DocumentLoaderError' });
  });
});
