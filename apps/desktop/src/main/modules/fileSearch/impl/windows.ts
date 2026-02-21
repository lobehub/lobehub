 
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

const logger = createLogger('module:FileSearch:windows');

/**
 * Fallback tool type for Windows file search
 * Priority: fd > powershell > fast-glob
 */
type WindowsFallbackTool = 'fd' | 'powershell' | 'fast-glob';

/**
 * Windows file search implementation
 * Uses fd > PowerShell > fast-glob fallback strategy
 */
export class WindowsSearchServiceImpl extends BaseFileSearch {
  /**
   * Current fallback tool being used
   */
  private currentTool: WindowsFallbackTool | null = null;

  constructor(toolDetectorManager?: ToolDetectorManager) {
    super(toolDetectorManager);
  }

  /**
   * Perform file search
   * @param options Search options
   * @returns Promise of search result list
   */
  async search(options: SearchOptions): Promise<FileResult[]> {
    // Determine the best available tool on first search
    if (this.currentTool === null) {
      this.currentTool = await this.determineBestTool();
      logger.info(`Using file search tool: ${this.currentTool}`);
    }

    return this.searchWithTool(this.currentTool, options);
  }

  /**
   * Determine the best available tool based on priority
   * Priority: fd > powershell > fast-glob
   */
  private async determineBestTool(): Promise<WindowsFallbackTool> {
    if (this.toolDetectorManager) {
      const bestTool = await this.toolDetectorManager.getBestTool('file-search');
      if (bestTool && ['fd', 'powershell'].includes(bestTool)) {
        return bestTool as WindowsFallbackTool;
      }
    }

    if (await this.checkToolAvailable('fd')) {
      return 'fd';
    }

    // PowerShell is always available on Windows
    return 'powershell';
  }

  /**
   * Check if a tool is available using 'where' command (Windows equivalent of 'which')
   * @param tool Tool name to check
   * @returns Promise indicating if tool is available
   */
  private async checkToolAvailable(tool: string): Promise<boolean> {
    try {
      await execa('where', [tool], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Search using the specified tool
   */
  private async searchWithTool(
    tool: WindowsFallbackTool,
    options: SearchOptions,
  ): Promise<FileResult[]> {
    switch (tool) {
      case 'fd': {
        return this.searchWithFd(options);
      }
      case 'powershell': {
        return this.searchWithPowerShell(options);
      }
      default: {
        return this.searchWithFastGlob(options);
      }
    }
  }

  /**
   * Fallback to the next available tool
   */
  private async fallbackToNextTool(currentTool: WindowsFallbackTool): Promise<WindowsFallbackTool> {
    const priority: WindowsFallbackTool[] = ['fd', 'powershell', 'fast-glob'];
    const currentIndex = priority.indexOf(currentTool);

    for (let i = currentIndex + 1; i < priority.length; i++) {
      const nextTool = priority[i];
      if (nextTool === 'fast-glob' || nextTool === 'powershell') {
        return nextTool; // Always available
      }
      if (await this.checkToolAvailable(nextTool)) {
        return nextTool;
      }
    }

    return 'fast-glob';
  }

  /**
   * Search using fd (cross-platform fast find alternative)
   * @param options Search options
   * @returns Search results
   */
  private async searchWithFd(options: SearchOptions): Promise<FileResult[]> {
    const searchDir = options.onlyIn || os.homedir() || 'C:\\';
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
        return this.searchWithTool(this.currentTool, options);
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
      return this.searchWithTool(this.currentTool, options);
    }
  }

  /**
   * Search using PowerShell Get-ChildItem
   * @param options Search options
   * @returns Search results
   */
  private async searchWithPowerShell(options: SearchOptions): Promise<FileResult[]> {
    const searchDir = options.onlyIn || os.homedir() || 'C:\\';
    const limit = options.limit || 30;

    logger.debug('Performing PowerShell search', { keywords: options.keywords, searchDir });

    try {
      // Build PowerShell command
      const filter = options.keywords ? `*${options.keywords}*` : '*';

      // PowerShell command to search files
      // -Recurse: recursive search
      // -File: only files
      // -Depth: limit search depth
      // -ErrorAction SilentlyContinue: ignore permission errors
      const psCommand = `
        Get-ChildItem -Path '${searchDir}' -Filter '${filter}' -Recurse -File -Depth 10 -ErrorAction SilentlyContinue |
        Where-Object {
          $_.FullName -notlike '*\\node_modules\\*' -and
          $_.FullName -notlike '*\\.git\\*' -and
          $_.FullName -notlike '*\\AppData\\Local\\Temp\\*' -and
          $_.FullName -notlike '*\\$Recycle.Bin\\*'
        } |
        Select-Object -First ${limit} -ExpandProperty FullName
      `;

      const { stdout, exitCode } = await execa(
        'powershell',
        ['-NoProfile', '-Command', psCommand],
        {
          reject: false,
          timeout: 30_000,
        },
      );

      if (exitCode !== 0 && !stdout.trim()) {
        logger.warn(`PowerShell search failed with code ${exitCode}, falling back to fast-glob`);
        this.currentTool = 'fast-glob';
        return this.searchWithFastGlob(options);
      }

      const files = stdout
        .trim()
        .split('\r\n')
        .filter((line) => line.trim());

      logger.debug(`PowerShell found ${files.length} files`);

      return this.processFilePaths(files, options, 'powershell');
    } catch (error) {
      logger.error('PowerShell search failed:', error);
      this.currentTool = 'fast-glob';
      logger.warn('PowerShell failed, falling back to fast-glob');
      return this.searchWithFastGlob(options);
    }
  }

  /**
   * Search using fast-glob (pure Node.js implementation)
   * @param options Search options
   * @returns Search results
   */
  private async searchWithFastGlob(options: SearchOptions): Promise<FileResult[]> {
    const searchDir = options.onlyIn || os.homedir() || 'C:\\';
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
        deep: 10,
        dot: false, // Windows hidden files use attributes, not dot prefix
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/AppData/Local/Temp/**',
          '**/AppData/Local/Microsoft/**',
          '**/$Recycle.Bin/**',
          '**/Windows/**',
          '**/Program Files/**',
          '**/Program Files (x86)/**',
        ],
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
   * Check search service status
   * @returns Promise indicating if service is available (always true)
   */
  async checkSearchServiceStatus(): Promise<boolean> {
    // At minimum, fast-glob is always available
    return true;
  }

  /**
   * Update search index
   * Windows Search index is managed by the OS
   * @returns Promise indicating operation result (always false)
   */
  async updateSearchIndex(): Promise<boolean> {
    logger.warn('updateSearchIndex is not supported (using fast-glob instead of Windows Search)');
    return false;
  }

  /**
   * Perform glob pattern matching
   * Uses fd > fast-glob fallback strategy
   * @param params Glob parameters
   * @returns Promise of glob result
   */
  async glob(params: GlobFilesParams): Promise<GlobFilesResult> {
    // Check if fd is available
    if (await this.checkToolAvailable('fd')) {
      logger.info('Using glob tool: fd');
      return this.globWithFd(params);
    }

    logger.info('Using glob tool: fast-glob');
    return this.globWithFastGlob(params);
  }

  /**
   * Glob using fd
   * @param params Glob parameters
   * @returns Glob results
   */
  private async globWithFd(params: GlobFilesParams): Promise<GlobFilesResult> {
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
        logger.warn(`${logPrefix} fd glob failed with code ${exitCode}, falling back to fast-glob`);
        return this.globWithFastGlob(params);
      }

      const files = stdout
        .trim()
        .split('\r\n') // Windows uses \r\n
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
      logger.warn(`${logPrefix} Falling back to fast-glob`);
      return this.globWithFastGlob(params);
    }
  }

  /**
   * Glob using fast-glob (Node.js fallback)
   * @param params Glob parameters
   * @returns Glob results
   */
  private async globWithFastGlob(params: GlobFilesParams): Promise<GlobFilesResult> {
    const searchPath = params.scope || process.cwd();
    const logPrefix = `[glob:fast-glob: ${params.pattern}]`;

    logger.debug(`${logPrefix} Starting fast-glob`, { searchPath });

    try {
      const files = await fg(params.pattern, {
        absolute: true,
        cwd: searchPath,
        dot: false, // Windows hidden files use attributes, not dot prefix
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
