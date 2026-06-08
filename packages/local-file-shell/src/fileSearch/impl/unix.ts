import { type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as os from 'node:os';

import { execa } from 'execa';
import fg from 'fast-glob';

import { createLogger } from '../../logger';
import { type ToolDetector } from '../../toolDetector';
import type { FileResult, GlobFilesParams, GlobFilesResult, SearchFilesParams } from '../../types';
import { BaseFileSearch } from '../base';

const logger = createLogger('fileSearch:unix');

/**
 * Fallback tool type for Unix file search
 * Priority: fd > find > fast-glob
 */
export type UnixSearchTool = 'fast-glob' | 'fd' | 'find';

/**
 * Unix file search base class
 * Provides common search implementations for macOS and Linux
 */
export abstract class UnixFileSearch extends BaseFileSearch {
  protected currentTool: UnixSearchTool | null = null;

  constructor(toolDetector?: ToolDetector) {
    super(toolDetector);
  }

  protected async checkToolAvailable(tool: string): Promise<boolean> {
    try {
      await execa('which', [tool], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  protected async determineBestUnixTool(): Promise<UnixSearchTool> {
    if (this.toolDetector) {
      const bestTool = await this.toolDetector.getBestTool('file-search');
      if (bestTool && ['fd', 'find'].includes(bestTool)) {
        return bestTool as UnixSearchTool;
      }
    }

    if (await this.checkToolAvailable('fd')) {
      return 'fd';
    }

    if (await this.checkToolAvailable('find')) {
      return 'find';
    }

    return 'fast-glob';
  }

  protected async fallbackToNextTool(currentTool: UnixSearchTool): Promise<UnixSearchTool> {
    const priority: UnixSearchTool[] = ['fd', 'find', 'fast-glob'];
    const currentIndex = priority.indexOf(currentTool);

    for (let i = currentIndex + 1; i < priority.length; i++) {
      const nextTool = priority[i];
      if (nextTool === 'fast-glob') {
        return 'fast-glob';
      }
      if (await this.checkToolAvailable(nextTool)) {
        return nextTool;
      }
    }

    return 'fast-glob';
  }

  protected async searchWithUnixTool(
    tool: UnixSearchTool,
    options: SearchFilesParams,
  ): Promise<FileResult[]> {
    switch (tool) {
      case 'fd': {
        return this.searchWithFd(options);
      }
      case 'find': {
        return this.searchWithFind(options);
      }
      default: {
        return this.searchWithFastGlob(options);
      }
    }
  }

  protected async searchWithFd(options: SearchFilesParams): Promise<FileResult[]> {
    const searchDir = options.onlyIn || options.directory || os.homedir() || '/';
    const limit = options.limit || 30;

    logger.debug('Performing fd search', { keywords: options.keywords, searchDir });

    try {
      const args: string[] = [];

      if (options.keywords) {
        args.push(options.keywords);
      } else {
        args.push('.');
      }

      args.push(searchDir, '--type', 'f', '--hidden', '--ignore-case', '--max-depth', '10');
      args.push(
        '--max-results',
        String(limit),
        '--exclude',
        'node_modules',
        '--exclude',
        '.git',
        '--exclude',
        '*cache*',
      );

      const { stdout, exitCode } = await execa('fd', args, {
        reject: false,
        timeout: 30_000,
      });

      if (exitCode !== 0 && !stdout.trim()) {
        logger.warn(`fd search failed with code ${exitCode}, falling back to next tool`);
        this.currentTool = await this.fallbackToNextTool('fd');
        return this.searchWithUnixTool(this.currentTool, options);
      }

      const files = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      logger.debug(`fd found ${files.length} files`);

      return this.processFilePaths(files, options, 'fd');
    } catch (error) {
      logger.error('fd search failed:', error);
      this.currentTool = await this.fallbackToNextTool('fd');
      logger.warn(`fd failed, falling back to: ${this.currentTool}`);
      return this.searchWithUnixTool(this.currentTool, options);
    }
  }

  protected async searchWithFind(options: SearchFilesParams): Promise<FileResult[]> {
    const searchDir = options.onlyIn || options.directory || os.homedir() || '/';
    const limit = options.limit || 30;

    logger.debug('Performing find search', { keywords: options.keywords, searchDir });

    try {
      const args: string[] = [
        searchDir,
        '-maxdepth',
        '10',
        '-type',
        'f',
        '(',
        '-path',
        '*/node_modules/*',
        '-o',
        '-path',
        '*/.git/*',
        '-o',
        '-path',
        '*/*cache*/*',
        ')',
        '-prune',
        '-o',
      ];

      if (options.keywords) {
        args.push('-iname', `*${options.keywords}*`);
      }

      args.push('-print');

      const { stdout, exitCode } = await execa('find', args, {
        reject: false,
        timeout: 30_000,
      });

      if (exitCode !== 0 && !stdout.trim()) {
        logger.warn(`find search failed with code ${exitCode}, falling back to fast-glob`);
        this.currentTool = 'fast-glob';
        return this.searchWithFastGlob(options);
      }

      const files = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .slice(0, limit);

      logger.debug(`find found ${files.length} files`);

      return this.processFilePaths(files, options, 'find');
    } catch (error) {
      logger.error('find search failed:', error);
      this.currentTool = 'fast-glob';
      logger.warn('find failed, falling back to fast-glob');
      return this.searchWithFastGlob(options);
    }
  }

  protected async searchWithFastGlob(options: SearchFilesParams): Promise<FileResult[]> {
    const searchDir = options.onlyIn || options.directory || os.homedir() || '/';
    const limit = options.limit || 30;

    logger.debug('Performing fast-glob search', { keywords: options.keywords, searchDir });

    try {
      const pattern = options.keywords
        ? `**/*${this.escapeGlobPattern(options.keywords)}*`
        : '**/*';

      const files = await fg(pattern, {
        absolute: true,
        caseSensitiveMatch: false,
        cwd: searchDir,
        deep: 10,
        dot: true,
        ignore: this.getDefaultIgnorePatterns(),
        onlyFiles: true,
        suppressErrors: true,
      });

      logger.debug(`fast-glob found ${files.length} files matching pattern`);

      const limitedFiles = files.slice(0, limit);
      return this.processFilePaths(limitedFiles, options, 'fast-glob');
    } catch (error) {
      logger.error('fast-glob search failed:', error);
      throw new Error(`File search failed: ${(error as Error).message}`, { cause: error });
    }
  }

  protected getDefaultIgnorePatterns(): string[] {
    return ['**/node_modules/**', '**/.git/**', '**/.*cache*/**'];
  }

  /**
   * Perform glob pattern matching
   * Uses fd when available; falls back to fast-glob to preserve globstar semantics.
   */
  async glob(params: GlobFilesParams): Promise<GlobFilesResult> {
    const tool = await this.determineBestUnixTool();
    const globTool = tool === 'find' ? 'fast-glob' : tool;
    logger.info(`Using glob tool: ${globTool}`);

    return this.globWithUnixTool(globTool, params);
  }

  protected async globWithUnixTool(
    tool: UnixSearchTool,
    params: GlobFilesParams,
  ): Promise<GlobFilesResult> {
    switch (tool) {
      case 'fd': {
        return this.globWithFd(params);
      }
      case 'find': {
        return this.globWithFastGlob(params);
      }
      default: {
        return this.globWithFastGlob(params);
      }
    }
  }

  protected async globWithFd(params: GlobFilesParams): Promise<GlobFilesResult> {
    const searchPath = params.scope || params.cwd || os.homedir() || process.cwd();
    const logPrefix = `[glob:fd: ${params.pattern}]`;

    logger.debug(`${logPrefix} Starting fd glob`, { searchPath });

    try {
      const args: string[] = [
        '--glob',
        params.pattern,
        searchPath,
        '--absolute-path',
        '--hidden',
        '--no-ignore',
        '--exclude',
        'node_modules',
        '--exclude',
        '.git',
      ];

      const { stdout, exitCode } = await execa('fd', args, {
        reject: false,
        timeout: 30_000,
      });

      if (exitCode !== 0 && !stdout.trim()) {
        logger.warn(`${logPrefix} fd glob failed with code ${exitCode}, falling back to fast-glob`);
        return this.globWithFastGlob(params);
      }

      const files = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      const filesWithStats = await this.getFilesWithStats(files);
      const sortedFiles = filesWithStats.sort((a, b) => b.mtime - a.mtime).map((f) => f.path);

      logger.info(`${logPrefix} Glob completed`, { fileCount: sortedFiles.length });

      return {
        engine: 'fd',
        files: sortedFiles,
        success: true,
        total_files: sortedFiles.length,
      };
    } catch (error) {
      logger.error(`${logPrefix} fd glob failed:`, error);
      logger.warn(`${logPrefix} Falling back to fast-glob`);
      return this.globWithFastGlob(params);
    }
  }

  protected async globWithFind(params: GlobFilesParams): Promise<GlobFilesResult> {
    const searchPath = params.scope || params.cwd || os.homedir() || process.cwd();
    const logPrefix = `[glob:find: ${params.pattern}]`;

    logger.debug(`${logPrefix} Starting find glob`, { searchPath });

    try {
      const pattern = params.pattern;
      const args: string[] = [searchPath];

      if (pattern.includes('/')) {
        args.push('-path', pattern);
      } else {
        args.push('-name', pattern);
      }

      const { stdout, exitCode } = await execa('find', args, {
        reject: false,
        timeout: 30_000,
      });

      if (exitCode !== 0 && !stdout.trim()) {
        logger.warn(
          `${logPrefix} find glob failed with code ${exitCode}, falling back to fast-glob`,
        );
        return this.globWithFastGlob(params);
      }

      const files = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      const filesWithStats = await this.getFilesWithStats(files);
      const sortedFiles = filesWithStats.sort((a, b) => b.mtime - a.mtime).map((f) => f.path);

      logger.info(`${logPrefix} Glob completed`, { fileCount: sortedFiles.length });

      return {
        engine: 'find',
        files: sortedFiles,
        success: true,
        total_files: sortedFiles.length,
      };
    } catch (error) {
      logger.error(`${logPrefix} find glob failed:`, error);
      logger.warn(`${logPrefix} Falling back to fast-glob`);
      return this.globWithFastGlob(params);
    }
  }

  protected async globWithFastGlob(params: GlobFilesParams): Promise<GlobFilesResult> {
    const searchPath = params.scope || params.cwd || os.homedir() || process.cwd();
    const logPrefix = `[glob:fast-glob: ${params.pattern}]`;

    logger.debug(`${logPrefix} Starting fast-glob`, { searchPath });

    try {
      const files = await fg(params.pattern, {
        absolute: true,
        cwd: searchPath,
        dot: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        onlyFiles: false,
        stats: true,
      });

      const sortedFiles = (files as unknown as Array<{ path: string; stats: Stats }>)
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime())
        .map((f) => f.path);

      logger.info(`${logPrefix} Glob completed`, { fileCount: sortedFiles.length });

      return {
        engine: 'fast-glob',
        files: sortedFiles,
        success: true,
        total_files: sortedFiles.length,
      };
    } catch (error) {
      logger.error(`${logPrefix} Glob failed:`, error);
      return {
        engine: 'fast-glob',
        error: (error as Error).message,
        files: [],
        success: false,
        total_files: 0,
      };
    }
  }

  private async getFilesWithStats(
    files: string[],
  ): Promise<Array<{ mtime: number; path: string }>> {
    const results: Array<{ mtime: number; path: string }> = [];

    for (const filePath of files) {
      try {
        const stats = await stat(filePath);
        results.push({ mtime: stats.mtime.getTime(), path: filePath });
      } catch {
        results.push({ mtime: 0, path: filePath });
      }
    }

    return results;
  }
}
