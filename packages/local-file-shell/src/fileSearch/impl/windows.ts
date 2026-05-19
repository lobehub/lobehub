import { type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as os from 'node:os';

import { execa } from 'execa';
import fg from 'fast-glob';

import { createLogger } from '../../logger';
import { type ToolDetector } from '../../toolDetector';
import type { FileResult, GlobFilesParams, GlobFilesResult, SearchFilesParams } from '../../types';
import { BaseFileSearch } from '../base';

const logger = createLogger('fileSearch:windows');

/**
 * Fallback tool type for Windows file search
 * Priority: fd > powershell > fast-glob
 */
type WindowsFallbackTool = 'fast-glob' | 'fd' | 'powershell';

/**
 * Windows file search implementation
 * Uses fd > PowerShell > fast-glob fallback strategy
 */
export class WindowsSearchServiceImpl extends BaseFileSearch {
  private currentTool: WindowsFallbackTool | null = null;

  constructor(toolDetector?: ToolDetector) {
    super(toolDetector);
  }

  async search(options: SearchFilesParams): Promise<FileResult[]> {
    if (this.currentTool === null) {
      this.currentTool = await this.determineBestTool();
      logger.info(`Using file search tool: ${this.currentTool}`);
    }

    return this.searchWithTool(this.currentTool, options);
  }

  private async determineBestTool(): Promise<WindowsFallbackTool> {
    if (this.toolDetector) {
      const bestTool = await this.toolDetector.getBestTool('file-search');
      if (bestTool && ['fd', 'powershell'].includes(bestTool)) {
        return bestTool as WindowsFallbackTool;
      }
    }

    if (await this.checkToolAvailable('fd')) {
      return 'fd';
    }

    return 'powershell';
  }

  private async checkToolAvailable(tool: string): Promise<boolean> {
    try {
      await execa('where', [tool], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  private async searchWithTool(
    tool: WindowsFallbackTool,
    options: SearchFilesParams,
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

  private async fallbackToNextTool(currentTool: WindowsFallbackTool): Promise<WindowsFallbackTool> {
    const priority: WindowsFallbackTool[] = ['fd', 'powershell', 'fast-glob'];
    const currentIndex = priority.indexOf(currentTool);

    for (let i = currentIndex + 1; i < priority.length; i++) {
      const nextTool = priority[i];
      if (nextTool === 'fast-glob' || nextTool === 'powershell') {
        return nextTool;
      }
      if (await this.checkToolAvailable(nextTool)) {
        return nextTool;
      }
    }

    return 'fast-glob';
  }

  private async searchWithFd(options: SearchFilesParams): Promise<FileResult[]> {
    const searchDir = options.onlyIn || options.directory || os.homedir() || 'C:\\';
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

  private async searchWithPowerShell(options: SearchFilesParams): Promise<FileResult[]> {
    const searchDir = options.onlyIn || options.directory || os.homedir() || 'C:\\';
    const limit = options.limit || 30;

    logger.debug('Performing PowerShell search', { keywords: options.keywords, searchDir });

    try {
      const filter = options.keywords ? `*${options.keywords}*` : '*';

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

  private async searchWithFastGlob(options: SearchFilesParams): Promise<FileResult[]> {
    const searchDir = options.onlyIn || options.directory || os.homedir() || 'C:\\';
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
        // Windows hidden files use attributes, not dot prefix
        dot: false,
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
      throw new Error(`File search failed: ${(error as Error).message}`, { cause: error });
    }
  }

  async checkSearchServiceStatus(): Promise<boolean> {
    return true;
  }

  async updateSearchIndex(): Promise<boolean> {
    logger.warn('updateSearchIndex is not supported (using fast-glob instead of Windows Search)');
    return false;
  }

  async glob(params: GlobFilesParams): Promise<GlobFilesResult> {
    if (await this.checkToolAvailable('fd')) {
      logger.info('Using glob tool: fd');
      return this.globWithFd(params);
    }

    logger.info('Using glob tool: fast-glob');
    return this.globWithFastGlob(params);
  }

  private async globWithFd(params: GlobFilesParams): Promise<GlobFilesResult> {
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
        .split('\r\n')
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

  private async globWithFastGlob(params: GlobFilesParams): Promise<GlobFilesResult> {
    const searchPath = params.scope || params.cwd || os.homedir() || process.cwd();
    const logPrefix = `[glob:fast-glob: ${params.pattern}]`;

    logger.debug(`${logPrefix} Starting fast-glob`, { searchPath });

    try {
      const files = await fg(params.pattern, {
        absolute: true,
        cwd: searchPath,
        // Windows hidden files use attributes, not dot prefix
        dot: false,
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
