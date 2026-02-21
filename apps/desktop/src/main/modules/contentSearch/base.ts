import { GrepContentParams, GrepContentResult } from '@lobechat/electron-client-ipc';
import fg from 'fast-glob';
import { readFile, stat } from 'node:fs/promises';

import { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';
import { createLogger } from '@/utils/logger';

const logger = createLogger('module:ContentSearch:base');

/**
 * Content search tool type
 */
export type ContentSearchTool = 'rg' | 'ag' | 'grep' | 'nodejs';

/**
 * Content Search Service Implementation Abstract Class
 * Defines the interface that different platform content search implementations need to implement
 */
export abstract class BaseContentSearch {
  protected toolDetectorManager?: ToolDetectorManager;

  constructor(toolDetectorManager?: ToolDetectorManager) {
    this.toolDetectorManager = toolDetectorManager;
  }

  /**
   * Set the tool detector manager
   * @param manager ToolDetectorManager instance
   */
  setToolDetectorManager(manager: ToolDetectorManager): void {
    this.toolDetectorManager = manager;
  }

  /**
   * Perform content search (grep)
   * @param params Grep parameters
   * @returns Promise of grep result
   */
  abstract grep(params: GrepContentParams): Promise<GrepContentResult>;

  /**
   * Check if a specific tool is available
   * @param tool Tool name to check
   * @returns Promise indicating if tool is available
   */
  abstract checkToolAvailable(tool: string): Promise<boolean>;

  /**
   * Build command-line arguments for grep tools
   */
  protected buildGrepArgs(tool: 'rg' | 'ag' | 'grep', params: GrepContentParams): string[] {
    const { pattern, output_mode = 'files_with_matches' } = params;
    const args: string[] = [];

    switch (tool) {
      case 'rg': {
        // ripgrep arguments
        if (params['-i']) args.push('-i');
        if (params['-n']) args.push('-n');
        if (params['-A']) args.push('-A', String(params['-A']));
        if (params['-B']) args.push('-B', String(params['-B']));
        if (params['-C']) args.push('-C', String(params['-C']));
        if (params.multiline) args.push('-U');
        if (params.glob) args.push('-g', params.glob);
        if (params.type) args.push('-t', params.type);

        // Output mode
        switch (output_mode) {
          case 'files_with_matches': {
            args.push('-l');
            break;
          }
          case 'count': {
            args.push('-c');
            break;
          }
        }

        // Ignore common directories (use **/ prefix to match nested paths)
        args.push('--glob', '!**/node_modules/**', '--glob', '!**/.git/**', pattern, '.');
        break;
      }

      case 'ag': {
        // Silver Searcher arguments
        if (params['-i']) args.push('-i');
        if (params['-A']) args.push('-A', String(params['-A']));
        if (params['-B']) args.push('-B', String(params['-B']));
        if (params['-C']) args.push('-C', String(params['-C']));
        if (params.glob) args.push('-G', params.glob);

        // Output mode
        switch (output_mode) {
          case 'files_with_matches': {
            args.push('-l');
            break;
          }
          case 'count': {
            args.push('-c');
            break;
          }
        }

        args.push('--ignore-dir', 'node_modules', '--ignore-dir', '.git', pattern, '.');
        break;
      }

      case 'grep': {
        // GNU grep arguments
        args.push('-r'); // recursive
        if (params['-i']) args.push('-i');
        if (params['-n']) args.push('-n');
        if (params['-A']) args.push('-A', String(params['-A']));
        if (params['-B']) args.push('-B', String(params['-B']));
        if (params['-C']) args.push('-C', String(params['-C']));
        if (params.glob) args.push('--include', params.glob);
        if (params.type) args.push('--include', `*.${params.type}`);

        // Output mode
        switch (output_mode) {
          case 'files_with_matches': {
            args.push('-l');
            break;
          }
          case 'count': {
            args.push('-c');
            break;
          }
        }

        args.push('--exclude-dir', 'node_modules', '--exclude-dir', '.git', '-E', pattern, '.');
        break;
      }
    }

    return args;
  }

  /**
   * Grep using Node.js native implementation (fallback)
   */
  protected async grepWithNodejs(params: GrepContentParams): Promise<GrepContentResult> {
    const {
      pattern,
      path: searchPath = process.cwd(),
      output_mode = 'files_with_matches',
    } = params;
    const logPrefix = `[grepContent:nodejs]`;

    const flags = `${params['-i'] ? 'i' : ''}${params.multiline ? 's' : ''}`;
    const regex = new RegExp(pattern, flags);

    // Determine files to search
    let filesToSearch: string[] = [];
    const stats = await stat(searchPath);

    if (stats.isFile()) {
      filesToSearch = [searchPath];
    } else {
      // Use glob pattern if provided, otherwise search all files
      let globPattern = params.glob || '**/*';
      if (params.glob && !params.glob.includes('/') && !params.glob.startsWith('**')) {
        globPattern = `**/${params.glob}`;
      }

      filesToSearch = await fg(globPattern, {
        absolute: true,
        cwd: searchPath,
        dot: true,
        ignore: this.getDefaultIgnorePatterns(),
      });

      // Filter by type if provided
      if (params.type) {
        const ext = `.${params.type}`;
        filesToSearch = filesToSearch.filter((file) => file.endsWith(ext));
      }
    }

    logger.debug(`${logPrefix} Found ${filesToSearch.length} files to search`);

    const matches: string[] = [];
    let totalMatches = 0;

    for (const filePath of filesToSearch) {
      try {
        const fileStats = await stat(filePath);
        if (!fileStats.isFile()) continue;

        const content = await readFile(filePath, 'utf8');
        const lines = content.split('\n');

        switch (output_mode) {
          case 'files_with_matches': {
            if (regex.test(content)) {
              matches.push(filePath);
              totalMatches++;
              if (params.head_limit && matches.length >= params.head_limit) break;
            }
            break;
          }
          case 'content': {
            const matchedLines: string[] = [];
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                const contextBefore = params['-B'] || params['-C'] || 0;
                const contextAfter = params['-A'] || params['-C'] || 0;

                const startLine = Math.max(0, i - contextBefore);
                const endLine = Math.min(lines.length - 1, i + contextAfter);

                for (let j = startLine; j <= endLine; j++) {
                  const lineNum = params['-n'] ? `${j + 1}:` : '';
                  matchedLines.push(`${filePath}:${lineNum}${lines[j]}`);
                }
                totalMatches++;
              }
            }
            matches.push(...matchedLines);
            if (params.head_limit && matches.length >= params.head_limit) break;
            break;
          }
          case 'count': {
            const globalRegex = new RegExp(pattern, `g${flags}`);
            const fileMatches = (content.match(globalRegex) || []).length;
            if (fileMatches > 0) {
              matches.push(`${filePath}:${fileMatches}`);
              totalMatches += fileMatches;
            }
            break;
          }
        }
      } catch (error) {
        logger.debug(`${logPrefix} Skipping file ${filePath}:`, error);
      }
    }

    logger.info(`${logPrefix} Search completed`, {
      matchCount: matches.length,
      totalMatches,
    });

    return {
      engine: 'nodejs',
      matches: params.head_limit ? matches.slice(0, params.head_limit) : matches,
      success: true,
      total_matches: totalMatches,
    };
  }

  /**
   * Get default ignore patterns
   * Can be overridden by subclasses for platform-specific patterns
   */
  protected getDefaultIgnorePatterns(): string[] {
    return ['**/node_modules/**', '**/.git/**'];
  }
}
