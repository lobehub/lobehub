import { GlobFilesParams, GlobFilesResult } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseFileSearch } from '../base';
import { FileResult, SearchOptions } from '../types';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({
    atime: new Date('2024-01-03'),
    birthtime: new Date('2024-01-01'),
    isDirectory: () => false,
    mtime: new Date('2024-01-02'),
    size: 1024,
  }),
}));

/**
 * Concrete implementation for testing
 */
class TestFileSearch extends BaseFileSearch {
  async search(options: SearchOptions): Promise<FileResult[]> {
    const files = ['/test/file.ts'];
    return this.processFilePaths(files, options, 'test-engine');
  }

  async glob(_params: GlobFilesParams): Promise<GlobFilesResult> {
    return {
      engine: 'test-engine',
      files: [],
      success: true,
      total_files: 0,
    };
  }

  async checkSearchServiceStatus(): Promise<boolean> {
    return true;
  }

  async updateSearchIndex(): Promise<boolean> {
    return true;
  }

  // Expose protected methods for testing
  public testDetermineContentType(ext: string): string {
    return this.determineContentType(ext);
  }

  public testEscapeGlobPattern(pattern: string): string {
    return this.escapeGlobPattern(pattern);
  }

  public testProcessFilePaths(
    filePaths: string[],
    options: SearchOptions,
    engine?: string,
  ): Promise<FileResult[]> {
    return this.processFilePaths(filePaths, options, engine);
  }

  public testSortResults(
    results: FileResult[],
    sortBy?: 'name' | 'date' | 'size',
    direction?: 'asc' | 'desc',
  ): FileResult[] {
    return this.sortResults(results, sortBy, direction);
  }
}

describe('BaseFileSearch', () => {
  let fileSearch: TestFileSearch;

  beforeEach(() => {
    vi.clearAllMocks();
    fileSearch = new TestFileSearch();
  });

  describe('determineContentType', () => {
    it('should return archive for zip extension', () => {
      expect(fileSearch.testDetermineContentType('zip')).toBe('archive');
      expect(fileSearch.testDetermineContentType('tar')).toBe('archive');
      expect(fileSearch.testDetermineContentType('gz')).toBe('archive');
    });

    it('should return audio for audio extensions', () => {
      expect(fileSearch.testDetermineContentType('mp3')).toBe('audio');
      expect(fileSearch.testDetermineContentType('wav')).toBe('audio');
      expect(fileSearch.testDetermineContentType('ogg')).toBe('audio');
    });

    it('should return video for video extensions', () => {
      expect(fileSearch.testDetermineContentType('mp4')).toBe('video');
      expect(fileSearch.testDetermineContentType('avi')).toBe('video');
      expect(fileSearch.testDetermineContentType('mkv')).toBe('video');
    });

    it('should return image for image extensions', () => {
      expect(fileSearch.testDetermineContentType('png')).toBe('image');
      expect(fileSearch.testDetermineContentType('jpg')).toBe('image');
      expect(fileSearch.testDetermineContentType('gif')).toBe('image');
    });

    it('should return document for document extensions', () => {
      expect(fileSearch.testDetermineContentType('pdf')).toBe('document');
      expect(fileSearch.testDetermineContentType('doc')).toBe('document');
      expect(fileSearch.testDetermineContentType('docx')).toBe('document');
    });

    it('should return code for code extensions', () => {
      expect(fileSearch.testDetermineContentType('ts')).toBe('code');
      expect(fileSearch.testDetermineContentType('js')).toBe('code');
      expect(fileSearch.testDetermineContentType('py')).toBe('code');
    });

    it('should return unknown for unrecognized extensions', () => {
      expect(fileSearch.testDetermineContentType('xyz')).toBe('unknown');
      expect(fileSearch.testDetermineContentType('foo')).toBe('unknown');
    });

    it('should be case insensitive', () => {
      expect(fileSearch.testDetermineContentType('PNG')).toBe('image');
      expect(fileSearch.testDetermineContentType('MP3')).toBe('audio');
    });
  });

  describe('escapeGlobPattern', () => {
    it('should escape special glob characters', () => {
      // The function escapes . as well since it's a regex special character
      expect(fileSearch.testEscapeGlobPattern('file*.ts')).toBe('file\\*\\.ts');
      expect(fileSearch.testEscapeGlobPattern('file?.ts')).toBe('file\\?\\.ts');
      expect(fileSearch.testEscapeGlobPattern('file[0-9].ts')).toBe('file\\[0-9\\]\\.ts');
    });

    it('should escape parentheses', () => {
      expect(fileSearch.testEscapeGlobPattern('file(1).ts')).toBe('file\\(1\\)\\.ts');
    });

    it('should escape curly braces', () => {
      expect(fileSearch.testEscapeGlobPattern('file{a,b}.ts')).toBe('file\\{a,b\\}\\.ts');
    });

    it('should escape backslashes', () => {
      expect(fileSearch.testEscapeGlobPattern('path\\file.ts')).toBe('path\\\\file\\.ts');
    });

    it('should escape dots', () => {
      expect(fileSearch.testEscapeGlobPattern('normal-file.ts')).toBe('normal-file\\.ts');
    });

    it('should return unchanged string if no special characters', () => {
      expect(fileSearch.testEscapeGlobPattern('normal-file-ts')).toBe('normal-file-ts');
    });
  });

  describe('processFilePaths', () => {
    it('should process file paths and return FileResult array', async () => {
      const options: SearchOptions = { keywords: 'test' };
      const results = await fileSearch.testProcessFilePaths(['/test/file.ts'], options, 'fd');

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('/test/file.ts');
      expect(results[0].name).toBe('file.ts');
      expect(results[0].type).toBe('ts');
      expect(results[0].engine).toBe('fd');
    });

    it('should include engine in results', async () => {
      const options: SearchOptions = { keywords: 'test' };
      const results = await fileSearch.testProcessFilePaths(['/test/file.ts'], options, 'mdfind');

      expect(results[0].engine).toBe('mdfind');
    });

    it('should handle undefined engine', async () => {
      const options: SearchOptions = { keywords: 'test' };
      const results = await fileSearch.testProcessFilePaths(['/test/file.ts'], options);

      expect(results[0].engine).toBeUndefined();
    });

    it('should determine content type from extension', async () => {
      const options: SearchOptions = { keywords: 'test' };
      const results = await fileSearch.testProcessFilePaths(['/test/file.ts'], options);

      expect(results[0].contentType).toBe('code');
    });
  });

  describe('sortResults', () => {
    const createMockResult = (name: string, size: number, modifiedTime: Date): FileResult => ({
      contentType: 'code',
      createdTime: new Date('2024-01-01'),
      isDirectory: false,
      lastAccessTime: new Date('2024-01-03'),
      metadata: {},
      modifiedTime,
      name,
      path: `/test/${name}`,
      size,
      type: 'ts',
    });

    it('should sort by name ascending', () => {
      const results = [
        createMockResult('c.ts', 100, new Date('2024-01-01')),
        createMockResult('a.ts', 200, new Date('2024-01-02')),
        createMockResult('b.ts', 150, new Date('2024-01-03')),
      ];

      const sorted = fileSearch.testSortResults(results, 'name', 'asc');

      expect(sorted[0].name).toBe('a.ts');
      expect(sorted[1].name).toBe('b.ts');
      expect(sorted[2].name).toBe('c.ts');
    });

    it('should sort by name descending', () => {
      const results = [
        createMockResult('a.ts', 100, new Date('2024-01-01')),
        createMockResult('c.ts', 200, new Date('2024-01-02')),
        createMockResult('b.ts', 150, new Date('2024-01-03')),
      ];

      const sorted = fileSearch.testSortResults(results, 'name', 'desc');

      expect(sorted[0].name).toBe('c.ts');
      expect(sorted[1].name).toBe('b.ts');
      expect(sorted[2].name).toBe('a.ts');
    });

    it('should sort by size ascending', () => {
      const results = [
        createMockResult('a.ts', 300, new Date('2024-01-01')),
        createMockResult('b.ts', 100, new Date('2024-01-02')),
        createMockResult('c.ts', 200, new Date('2024-01-03')),
      ];

      const sorted = fileSearch.testSortResults(results, 'size', 'asc');

      expect(sorted[0].size).toBe(100);
      expect(sorted[1].size).toBe(200);
      expect(sorted[2].size).toBe(300);
    });

    it('should sort by date ascending', () => {
      const results = [
        createMockResult('a.ts', 100, new Date('2024-03-01')),
        createMockResult('b.ts', 200, new Date('2024-01-01')),
        createMockResult('c.ts', 150, new Date('2024-02-01')),
      ];

      const sorted = fileSearch.testSortResults(results, 'date', 'asc');

      expect(sorted[0].name).toBe('b.ts');
      expect(sorted[1].name).toBe('c.ts');
      expect(sorted[2].name).toBe('a.ts');
    });

    it('should return original array if no sortBy specified', () => {
      const results = [
        createMockResult('c.ts', 100, new Date('2024-01-01')),
        createMockResult('a.ts', 200, new Date('2024-01-02')),
      ];

      const sorted = fileSearch.testSortResults(results);

      expect(sorted[0].name).toBe('c.ts');
      expect(sorted[1].name).toBe('a.ts');
    });
  });

  describe('setToolDetectorManager', () => {
    it('should set the tool detector manager', () => {
      const mockManager = {} as any;

      fileSearch.setToolDetectorManager(mockManager);

      expect((fileSearch as any).toolDetectorManager).toBe(mockManager);
    });
  });

  describe('search', () => {
    it('should return results with engine', async () => {
      const results = await fileSearch.search({ keywords: 'test' });

      expect(results[0].engine).toBe('test-engine');
    });
  });

  describe('glob', () => {
    it('should return GlobFilesResult with engine', async () => {
      const result = await fileSearch.glob({ pattern: '*.ts' });

      expect(result.engine).toBe('test-engine');
      expect(result.success).toBe(true);
    });
  });

  describe('checkSearchServiceStatus', () => {
    it('should return true', async () => {
      const status = await fileSearch.checkSearchServiceStatus();

      expect(status).toBe(true);
    });
  });

  describe('updateSearchIndex', () => {
    it('should return true', async () => {
      const result = await fileSearch.updateSearchIndex();

      expect(result).toBe(true);
    });
  });
});
