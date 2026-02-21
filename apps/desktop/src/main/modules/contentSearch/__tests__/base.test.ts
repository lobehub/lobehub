import { GrepContentParams, GrepContentResult } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseContentSearch } from '../base';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock fast-glob
vi.mock('fast-glob', () => ({
  default: vi.fn().mockResolvedValue([]),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(''),
  stat: vi.fn().mockResolvedValue({
    isDirectory: () => false,
    isFile: () => true,
  }),
}));

/**
 * Concrete implementation for testing
 */
class TestContentSearch extends BaseContentSearch {
  public currentTool: string | null = null;

  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    return this.grepWithNodejs(params);
  }

  async checkToolAvailable(tool: string): Promise<boolean> {
    return tool === 'nodejs';
  }

  // Expose protected methods for testing
  public testBuildGrepArgs(tool: 'rg' | 'ag' | 'grep', params: GrepContentParams): string[] {
    return this.buildGrepArgs(tool, params);
  }

  public testGetDefaultIgnorePatterns(): string[] {
    return this.getDefaultIgnorePatterns();
  }
}

describe('BaseContentSearch', () => {
  let contentSearch: TestContentSearch;

  beforeEach(() => {
    vi.clearAllMocks();
    contentSearch = new TestContentSearch();
  });

  describe('buildGrepArgs', () => {
    describe('ripgrep (rg)', () => {
      it('should build basic rg args for files_with_matches mode', () => {
        const params: GrepContentParams = {
          pattern: 'test',
          output_mode: 'files_with_matches',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).toContain('-l');
        expect(args).toContain('test');
        expect(args).toContain('--glob');
        expect(args).toContain('!**/node_modules/**');
        expect(args).toContain('!**/.git/**');
      });

      it('should build rg args with case insensitive flag', () => {
        const params: GrepContentParams = {
          '-i': true,
          'pattern': 'test',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).toContain('-i');
      });

      it('should build rg args with line numbers', () => {
        const params: GrepContentParams = {
          '-n': true,
          'pattern': 'test',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).toContain('-n');
      });

      it('should build rg args with context lines', () => {
        const params: GrepContentParams = {
          '-A': 3,
          '-B': 2,
          '-C': 1,
          'pattern': 'test',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).toContain('-A');
        expect(args).toContain('3');
        expect(args).toContain('-B');
        expect(args).toContain('2');
        expect(args).toContain('-C');
        expect(args).toContain('1');
      });

      it('should build rg args with multiline flag', () => {
        const params: GrepContentParams = {
          multiline: true,
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).toContain('-U');
      });

      it('should build rg args with glob filter', () => {
        const params: GrepContentParams = {
          glob: '*.ts',
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).toContain('-g');
        expect(args).toContain('*.ts');
      });

      it('should build rg args with type filter', () => {
        const params: GrepContentParams = {
          pattern: 'test',
          type: 'ts',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).toContain('-t');
        expect(args).toContain('ts');
      });

      it('should build rg args for count mode', () => {
        const params: GrepContentParams = {
          output_mode: 'count',
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).toContain('-c');
      });

      it('should build rg args for content mode', () => {
        const params: GrepContentParams = {
          output_mode: 'content',
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('rg', params);

        expect(args).not.toContain('-l');
        expect(args).not.toContain('-c');
      });
    });

    describe('silver searcher (ag)', () => {
      it('should build basic ag args for files_with_matches mode', () => {
        const params: GrepContentParams = {
          output_mode: 'files_with_matches',
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('ag', params);

        expect(args).toContain('-l');
        expect(args).toContain('--ignore-dir');
        expect(args).toContain('node_modules');
      });

      it('should build ag args with glob filter', () => {
        const params: GrepContentParams = {
          glob: '*.tsx',
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('ag', params);

        expect(args).toContain('-G');
        expect(args).toContain('*.tsx');
      });

      it('should build ag args for count mode', () => {
        const params: GrepContentParams = {
          output_mode: 'count',
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('ag', params);

        expect(args).toContain('-c');
      });
    });

    describe('grep', () => {
      it('should build basic grep args for files_with_matches mode', () => {
        const params: GrepContentParams = {
          output_mode: 'files_with_matches',
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('grep', params);

        expect(args).toContain('-r');
        expect(args).toContain('-l');
        expect(args).toContain('-E');
        expect(args).toContain('--exclude-dir');
        expect(args).toContain('node_modules');
      });

      it('should build grep args with include filter', () => {
        const params: GrepContentParams = {
          glob: '*.js',
          pattern: 'test',
        };

        const args = contentSearch.testBuildGrepArgs('grep', params);

        expect(args).toContain('--include');
        expect(args).toContain('*.js');
      });

      it('should build grep args with type filter', () => {
        const params: GrepContentParams = {
          pattern: 'test',
          type: 'py',
        };

        const args = contentSearch.testBuildGrepArgs('grep', params);

        expect(args).toContain('--include');
        expect(args).toContain('*.py');
      });
    });
  });

  describe('getDefaultIgnorePatterns', () => {
    it('should return default ignore patterns', () => {
      const patterns = contentSearch.testGetDefaultIgnorePatterns();

      expect(patterns).toContain('**/node_modules/**');
      expect(patterns).toContain('**/.git/**');
    });
  });

  describe('checkToolAvailable', () => {
    it('should return true for nodejs', async () => {
      const available = await contentSearch.checkToolAvailable('nodejs');

      expect(available).toBe(true);
    });

    it('should return false for other tools', async () => {
      const available = await contentSearch.checkToolAvailable('rg');

      expect(available).toBe(false);
    });
  });

  describe('setToolDetectorManager', () => {
    it('should set the tool detector manager', () => {
      const mockManager = {} as any;

      contentSearch.setToolDetectorManager(mockManager);

      expect((contentSearch as any).toolDetectorManager).toBe(mockManager);
    });
  });
});
