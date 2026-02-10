 
import { type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as os from 'node:os';

import { type GlobFilesParams, type GlobFilesResult } from '@lobechat/electron-client-ipc';
import { execa } from 'execa';
import fg from 'fast-glob';

import { type ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';
import { createLogger } from '@/utils/logger';

import { BaseFileSearch } from '../base';
import { type FileResult, type SearchOptions } from '../types';

const logger = createLogger('module:FileSearch:unix');

/**
 * Fallback tool type for Unix file search
 * Priority: fd > find > fast-glob
 */
export type UnixSearchTool = 'fd' | 'find' | 'fast-glob';

/**
 * Unix file search base class
 * Provides common search implementations for macOS and Linux
 */
export abstract class UnixFileSearch extends BaseFileSearch {
  /**
   * Current fallback tool being used
   */
  protected currentTool: UnixSearchTool | null = null;

  constructor(toolDetectorManager?: ToolDetectorManager) {
    super(toolDetectorManager);
  }

  /**
   * Check if a tool is available using 'which' command
   * @param tool Tool name to check
   * @returns Promise indicating if tool is available
   */
  protected async checkToolAvailable(tool: string): Promise<boolean> {
    try {
      await execa('which', [tool], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Determine the best available Unix tool based on priority
   * Priority: fd > find > fast-glob
   * @returns The best available tool
   */
  protected async determineBestUnixTool(): Promise<UnixSearchTool> {
    if (this.toolDetectorManager) {
      const bestTool = await this.toolDetectorManager.getBestTool('file-search');
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

  /**
   * Fallback to the next available tool
   * @param currentTool Current tool that failed
   * @returns Next tool to try
   */
  protected async fallbackToNextTool(currentTool: UnixSearchTool): Promise<UnixSearchTool> {
    const priority: UnixSearchTool[] = ['fd', 'find', 'fast-glob'];
    const currentIndex = priority.indexOf(currentTool);

    for (let i = currentIndex + 1; i < priority.length; i++) {
      const nextTool = priority[i];
      if (nextTool === 'fast-glob') {
        return 'fast-glob'; // Always available
      }
      if (await this.checkToolAvailable(nextTool)) {
        return nextTool;
      }
    }

    return 'fast-glob';
  }

  /**
   * Search using the specified Unix tool
   * @param tool Tool to use for search
   * @param options Search options
   * @returns Search results
   */
  protected async searchWithUnixTool(
    tool: UnixSearchTool,
    options: SearchOptions,
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

  /**
   * Search using fd (fast find alternative)
   * @param options Search options
   * @returns Search results
   */
  protected async searchWithFd(options: SearchOptions): Promise<FileResult[]> {
    const searchDir = options.onlyIn || os.homedir() || '/';
    const limit = options.limit || 30;

    logger.debug('Performing fd search', { keywords: options.keywords, searchDir });

    try {
      const args: string[] = [];

      // Pattern matching
      if (options.keywords) {
        args.push(options.keywords);
      } else {
        args.push('.'); // Match all files
      }

      // Search directory and options
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

  /**
   * Search using find (Unix standard tool)
   * @param options Search options
   * @returns Search results
   */
  protected async searchWithFind(options: SearchOptions): Promise<FileResult[]> {
    const searchDir = options.onlyIn || os.homedir() || '/';
    const limit = options.limit || 30;

    logger.debug('Performing find search', { keywords: options.keywords, searchDir });

    try {
      const args: string[] = [searchDir, 
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
        '-o'];

      // Limit depth and exclude common directories

      // Pattern matching
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

  /**
   * Search using fast-glob (pure Node.js implementation)
   * @param options Search options
   * @returns Search results
   */
  protected async searchWithFastGlob(options: SearchOptions): Promise<FileResult[]> {
    const searchDir = options.onlyIn || os.homedir() || '/';
    const limit = options.limit || 30;

    logger.debug('Performing fast-glob search', { keywords: options.keywords, searchDir });

    try {
      // Build glob pattern from keywords
      const pattern = options.keywords
        ? `**/*${this.escapeGlobPattern(options.keywords)}*`
        : '**/*';

      const files = await fg(pattern, {
        absolute: true,
        caseSensitiveMatch: false,
        cwd: searchDir,
        deep: 10, // Limit depth for performance
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
      throw new Error(`File search failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get default ignore patterns for fast-glob
   * Can be overridden by subclasses for platform-specific patterns
   * @returns Array of ignore patterns
   */
  protected getDefaultIgnorePatterns(): string[] {
    return ['**/node_modules/**', '**/.git/**', '**/.*cache*/**'];
  }

  /**
   * Perform glob pattern matching
   * Uses fd > find > fast-glob fallback strategy
   * @param params Glob parameters
   * @returns Promise of glob result
   */
  async glob(params: GlobFilesParams): Promise<GlobFilesResult> {
    // Determine the best available tool
    const tool = await this.determineBestUnixTool();
    logger.info(`Using glob tool: ${tool}`);

    return this.globWithUnixTool(tool, params);
  }

  /**
   * Glob using the specified Unix tool
   * @param tool Tool to use for glob
   * @param params Glob parameters
   * @returns Glob results
   */
  protected async globWithUnixTool(
    tool: UnixSearchTool,
    params: GlobFilesParams,
  ): Promise<GlobFilesResult> {
    switch (tool) {
      case 'fd': {
        return this.globWithFd(params);
      }
      case 'find': {
        return this.globWithFind(params);
      }
      default: {
        return this.globWithFastGlob(params);
      }
    }
  }

  /**
   * Glob using fd
   * @param params Glob parameters
   * @returns Glob results
   */
  protected async globWithFd(params: GlobFilesParams): Promise<GlobFilesResult> {
    const searchPath = params.scope || process.cwd();
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
      ];

      const { stdout, exitCode } = await execa('fd', args, {
        reject: false,
        timeout: 30_000,
      });

      if (exitCode !== 0 && !stdout.trim()) {
        logger.warn(`${logPrefix} fd glob failed with code ${exitCode}, falling back to find`);
        return this.globWithFind(params);
      }

      const files = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      // Get stats for sorting by mtime
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
      logger.warn(`${logPrefix} Falling back to find`);
      return this.globWithFind(params);
    }
  }

  /**
   * Glob using find
   * Note: find has limited glob support, converts pattern to -name/-path
   * @param params Glob parameters
   * @returns Glob results
   */
  protected async globWithFind(params: GlobFilesParams): Promise<GlobFilesResult> {
    const searchPath = params.scope || process.cwd();
    const logPrefix = `[glob:find: ${params.pattern}]`;

    logger.debug(`${logPrefix} Starting find glob`, { searchPath });

    try {
      // Convert glob pattern to find -name pattern
      // find doesn't support full glob, so we do basic conversion
      const pattern = params.pattern;
      const args: string[] = [searchPath];

      // Check if pattern contains directory separators
      if (pattern.includes('/')) {
        // Use -path for patterns with directories
        args.push('-path', pattern);
      } else {
        // Use -name for simple patterns
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

      // Get stats for sorting by mtime
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

  /**
   * Glob using fast-glob (Node.js fallback)
   * @param params Glob parameters
   * @returns Glob results
   */
  protected async globWithFastGlob(params: GlobFilesParams): Promise<GlobFilesResult> {
    const searchPath = params.scope || process.cwd();
    const logPrefix = `[glob:fast-glob: ${params.pattern}]`;

    logger.debug(`${logPrefix} Starting fast-glob`, { searchPath });

    try {
      const files = await fg(params.pattern, {
        absolute: true,
        cwd: searchPath,
        dot: true,
        onlyFiles: false,
        stats: true,
      });

      // Sort by modification time (most recent first)
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

  /**
   * Get file stats for sorting
   * @param files File paths
   * @returns Files with mtime
   */
  private async getFilesWithStats(
    files: string[],
  ): Promise<Array<{ mtime: number; path: string }>> {
    const results: Array<{ mtime: number; path: string }> = [];

    for (const filePath of files) {
      try {
        const stats = await stat(filePath);
        results.push({ mtime: stats.mtime.getTime(), path: filePath });
      } catch {
        // Skip files that can't be stat'd
        results.push({ mtime: 0, path: filePath });
      }
    }

    return results;
  }
}
