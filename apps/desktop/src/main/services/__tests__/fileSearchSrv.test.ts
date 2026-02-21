import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import type { FileResult, SearchOptions } from '@/modules/fileSearch';

import FileSearchService from '../fileSearchSrv';

// Mock the fileSearch module
vi.mock('@/modules/fileSearch', () => {
  const MockFileSearchImpl = vi.fn().mockImplementation(() => ({
    search: vi.fn(),
    checkSearchServiceStatus: vi.fn(),
    updateSearchIndex: vi.fn(),
  }));

  return {
    BaseFileSearch: vi.fn(),
    createFileSearchModule: vi.fn(() => new MockFileSearchImpl()),
  };
});

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('FileSearchService', () => {
  let fileSearchService: FileSearchService;
  let mockApp: App;
  let mockImpl: {
    search: ReturnType<typeof vi.fn>;
    checkSearchServiceStatus: ReturnType<typeof vi.fn>;
    updateSearchIndex: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mock app
    mockApp = {} as unknown as App;

    fileSearchService = new FileSearchService(mockApp);

    // Get the mock implementation instance
    mockImpl = (fileSearchService as any).impl;
  });

  describe('search', () => {
    it('should perform search with query and default options', async () => {
      const mockResults: FileResult[] = [
        {
          name: 'test.txt',
          path: '/home/user/test.txt',
          type: 'text/plain',
          size: 1024,
          isDirectory: false,
          createdTime: new Date('2024-01-01'),
          modifiedTime: new Date('2024-01-02'),
          lastAccessTime: new Date('2024-01-03'),
        },
      ];

      mockImpl.search.mockResolvedValue(mockResults);

      const result = await fileSearchService.search('test');

      expect(mockImpl.search).toHaveBeenCalledWith({ keywords: 'test' });
      expect(result).toEqual(mockResults);
    });

    it('should perform search with query and custom options', async () => {
      const mockResults: FileResult[] = [
        {
          name: 'document.pdf',
          path: '/home/user/documents/document.pdf',
          type: 'application/pdf',
          size: 2048,
          isDirectory: false,
          createdTime: new Date('2024-02-01'),
          modifiedTime: new Date('2024-02-02'),
          lastAccessTime: new Date('2024-02-03'),
        },
      ];

      const options: Omit<SearchOptions, 'keywords'> = {
        limit: 10,
        fileTypes: ['public.pdf'],
        onlyIn: '/home/user/documents',
      };

      mockImpl.search.mockResolvedValue(mockResults);

      const result = await fileSearchService.search('document', options);

      expect(mockImpl.search).toHaveBeenCalledWith({
        keywords: 'document',
        limit: 10,
        fileTypes: ['public.pdf'],
        onlyIn: '/home/user/documents',
      });
      expect(result).toEqual(mockResults);
    });

    it('should perform search with date filters', async () => {
      const mockResults: FileResult[] = [];
      const createdAfter = new Date('2024-01-01');
      const createdBefore = new Date('2024-12-31');

      mockImpl.search.mockResolvedValue(mockResults);

      await fileSearchService.search('test', {
        createdAfter,
        createdBefore,
      });

      expect(mockImpl.search).toHaveBeenCalledWith({
        keywords: 'test',
        createdAfter,
        createdBefore,
      });
    });

    it('should perform search with content filter', async () => {
      const mockResults: FileResult[] = [];

      mockImpl.search.mockResolvedValue(mockResults);

      await fileSearchService.search('test', {
        contentContains: 'specific text',
      });

      expect(mockImpl.search).toHaveBeenCalledWith({
        keywords: 'test',
        contentContains: 'specific text',
      });
    });

    it('should perform search with sorting options', async () => {
      const mockResults: FileResult[] = [];

      mockImpl.search.mockResolvedValue(mockResults);

      await fileSearchService.search('test', {
        sortBy: 'date',
        sortDirection: 'desc',
      });

      expect(mockImpl.search).toHaveBeenCalledWith({
        keywords: 'test',
        sortBy: 'date',
        sortDirection: 'desc',
      });
    });

    it('should perform search with exclude filter', async () => {
      const mockResults: FileResult[] = [];

      mockImpl.search.mockResolvedValue(mockResults);

      await fileSearchService.search('test', {
        exclude: ['/node_modules', '/dist'],
      });

      expect(mockImpl.search).toHaveBeenCalledWith({
        keywords: 'test',
        exclude: ['/node_modules', '/dist'],
      });
    });

    it('should return empty array when no results found', async () => {
      mockImpl.search.mockResolvedValue([]);

      const result = await fileSearchService.search('nonexistent');

      expect(result).toEqual([]);
    });

    it('should return results with metadata when detailed option is enabled', async () => {
      const mockResults: FileResult[] = [
        {
          name: 'image.jpg',
          path: '/home/user/images/image.jpg',
          type: 'image/jpeg',
          size: 4096,
          isDirectory: false,
          createdTime: new Date('2024-03-01'),
          modifiedTime: new Date('2024-03-02'),
          lastAccessTime: new Date('2024-03-03'),
          metadata: {
            width: 1920,
            height: 1080,
            orientation: 'landscape',
          },
        },
      ];

      mockImpl.search.mockResolvedValue(mockResults);

      const result = await fileSearchService.search('image', { detailed: true });

      expect(mockImpl.search).toHaveBeenCalledWith({
        keywords: 'image',
        detailed: true,
      });
      expect(result[0].metadata).toBeDefined();
      expect(result[0].metadata?.width).toBe(1920);
    });

    it('should handle search errors gracefully', async () => {
      mockImpl.search.mockRejectedValue(new Error('Search service unavailable'));

      await expect(fileSearchService.search('test')).rejects.toThrow('Search service unavailable');
    });

    it('should perform search with all available options', async () => {
      const mockResults: FileResult[] = [];
      const allOptions: Omit<SearchOptions, 'keywords'> = {
        limit: 50,
        fileTypes: ['public.image', 'public.movie'],
        onlyIn: '/home/user/media',
        exclude: ['/home/user/media/temp'],
        contentContains: 'vacation',
        createdAfter: new Date('2024-01-01'),
        createdBefore: new Date('2024-12-31'),
        modifiedAfter: new Date('2024-06-01'),
        modifiedBefore: new Date('2024-12-31'),
        sortBy: 'size',
        sortDirection: 'desc',
        detailed: true,
        liveUpdate: false,
      };

      mockImpl.search.mockResolvedValue(mockResults);

      await fileSearchService.search('vacation photos', allOptions);

      expect(mockImpl.search).toHaveBeenCalledWith({
        keywords: 'vacation photos',
        ...allOptions,
      });
    });
  });

  describe('checkSearchServiceStatus', () => {
    it('should return true when search service is available', async () => {
      mockImpl.checkSearchServiceStatus.mockResolvedValue(true);

      const result = await fileSearchService.checkSearchServiceStatus();

      expect(mockImpl.checkSearchServiceStatus).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when search service is unavailable', async () => {
      mockImpl.checkSearchServiceStatus.mockResolvedValue(false);

      const result = await fileSearchService.checkSearchServiceStatus();

      expect(mockImpl.checkSearchServiceStatus).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should handle status check errors', async () => {
      mockImpl.checkSearchServiceStatus.mockRejectedValue(
        new Error('Unable to check service status'),
      );

      await expect(fileSearchService.checkSearchServiceStatus()).rejects.toThrow(
        'Unable to check service status',
      );
    });
  });

  describe('updateSearchIndex', () => {
    it('should update search index without path', async () => {
      mockImpl.updateSearchIndex.mockResolvedValue(true);

      const result = await fileSearchService.updateSearchIndex();

      expect(mockImpl.updateSearchIndex).toHaveBeenCalledWith(undefined);
      expect(result).toBe(true);
    });

    it('should update search index with specified path', async () => {
      mockImpl.updateSearchIndex.mockResolvedValue(true);

      const result = await fileSearchService.updateSearchIndex('/home/user/documents');

      expect(mockImpl.updateSearchIndex).toHaveBeenCalledWith('/home/user/documents');
      expect(result).toBe(true);
    });

    it('should return false when index update fails', async () => {
      mockImpl.updateSearchIndex.mockResolvedValue(false);

      const result = await fileSearchService.updateSearchIndex('/home/user/documents');

      expect(result).toBe(false);
    });

    it('should handle index update errors', async () => {
      mockImpl.updateSearchIndex.mockRejectedValue(new Error('Index update failed'));

      await expect(fileSearchService.updateSearchIndex('/home/user/documents')).rejects.toThrow(
        'Index update failed',
      );
    });

    it('should handle index update for multiple different paths', async () => {
      mockImpl.updateSearchIndex.mockResolvedValue(true);

      const paths = ['/home/user/documents', '/home/user/downloads', '/home/user/desktop'];

      for (const path of paths) {
        const result = await fileSearchService.updateSearchIndex(path);
        expect(result).toBe(true);
      }

      expect(mockImpl.updateSearchIndex).toHaveBeenCalledTimes(paths.length);
    });
  });

  describe('integration behavior', () => {
    it('should maintain consistent state across multiple operations', async () => {
      mockImpl.checkSearchServiceStatus.mockResolvedValue(true);
      mockImpl.updateSearchIndex.mockResolvedValue(true);
      mockImpl.search.mockResolvedValue([]);

      const statusBefore = await fileSearchService.checkSearchServiceStatus();
      expect(statusBefore).toBe(true);

      await fileSearchService.updateSearchIndex('/home/user');

      const statusAfter = await fileSearchService.checkSearchServiceStatus();
      expect(statusAfter).toBe(true);

      const results = await fileSearchService.search('test');
      expect(results).toEqual([]);
    });

    it('should handle directory search results correctly', async () => {
      const mockResults: FileResult[] = [
        {
          name: 'documents',
          path: '/home/user/documents',
          type: 'directory',
          size: 0,
          isDirectory: true,
          createdTime: new Date('2024-01-01'),
          modifiedTime: new Date('2024-01-02'),
          lastAccessTime: new Date('2024-01-03'),
        },
      ];

      mockImpl.search.mockResolvedValue(mockResults);

      const result = await fileSearchService.search('documents');

      expect(result[0].isDirectory).toBe(true);
      expect(result[0].type).toBe('directory');
    });

    it('should handle mixed file and directory results', async () => {
      const mockResults: FileResult[] = [
        {
          name: 'documents',
          path: '/home/user/documents',
          type: 'directory',
          size: 0,
          isDirectory: true,
          createdTime: new Date('2024-01-01'),
          modifiedTime: new Date('2024-01-02'),
          lastAccessTime: new Date('2024-01-03'),
        },
        {
          name: 'readme.txt',
          path: '/home/user/documents/readme.txt',
          type: 'text/plain',
          size: 512,
          isDirectory: false,
          createdTime: new Date('2024-01-01'),
          modifiedTime: new Date('2024-01-02'),
          lastAccessTime: new Date('2024-01-03'),
        },
      ];

      mockImpl.search.mockResolvedValue(mockResults);

      const result = await fileSearchService.search('readme');

      expect(result).toHaveLength(2);
      expect(result[0].isDirectory).toBe(true);
      expect(result[1].isDirectory).toBe(false);
    });
  });
});
