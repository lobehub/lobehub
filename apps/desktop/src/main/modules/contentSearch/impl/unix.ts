/* eslint-disable unicorn/no-array-push-push */
import { GrepContentParams, GrepContentResult } from '@lobechat/electron-client-ipc';
import { execa } from 'execa';

import { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';
import { createLogger } from '@/utils/logger';

import { BaseContentSearch } from '../base';

const logger = createLogger('module:ContentSearch:unix');

/**
 * Unix content search tool type
 * Priority: rg (1) > ag (2) > grep (3)
 */
export type UnixContentSearchTool = 'rg' | 'ag' | 'grep' | 'nodejs';

/**
 * Unix content search base class
 * Provides common search implementations for macOS and Linux
 */
export abstract class UnixContentSearch extends BaseContentSearch {
  /**
   * Current tool being used
   */
  protected currentTool: UnixContentSearchTool | null = null;

  constructor(toolDetectorManager?: ToolDetectorManager) {
    super(toolDetectorManager);
  }

  /**
   * Check if a tool is available using 'which' command
   * @param tool Tool name to check
   * @returns Promise indicating if tool is available
   */
  async checkToolAvailable(tool: string): Promise<boolean> {
    try {
      await execa('which', [tool], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Determine the best available Unix tool based on priority
   * Priority: rg > ag > grep > nodejs
   * @returns The best available tool
   */
  protected async determineBestUnixTool(): Promise<UnixContentSearchTool> {
    if (this.toolDetectorManager) {
      const bestTool = await this.toolDetectorManager.getBestTool('content-search');
      if (bestTool && ['rg', 'ag', 'grep'].includes(bestTool)) {
        return bestTool as UnixContentSearchTool;
      }
    }

    if (await this.checkToolAvailable('rg')) {
      return 'rg';
    }

    if (await this.checkToolAvailable('ag')) {
      return 'ag';
    }

    if (await this.checkToolAvailable('grep')) {
      return 'grep';
    }

    return 'nodejs';
  }

  /**
   * Fallback to the next available tool
   * @param currentTool Current tool that failed
   * @returns Next tool to try
   */
  protected async fallbackToNextTool(
    currentTool: UnixContentSearchTool,
  ): Promise<UnixContentSearchTool> {
    const priority: UnixContentSearchTool[] = ['rg', 'ag', 'grep', 'nodejs'];
    const currentIndex = priority.indexOf(currentTool);

    for (let i = currentIndex + 1; i < priority.length; i++) {
      const nextTool = priority[i];
      if (nextTool === 'nodejs') {
        return 'nodejs'; // Always available
      }
      if (await this.checkToolAvailable(nextTool)) {
        return nextTool;
      }
    }

    return 'nodejs';
  }

  /**
   * Perform content search (grep)
   */
  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    const { tool: preferredTool } = params;
    const logPrefix = `[grepContent: ${params.pattern}]`;

    try {
      // If user specified a grep tool, try to use it
      if (preferredTool && ['rg', 'ag', 'grep'].includes(preferredTool)) {
        logger.debug(`${logPrefix} Using preferred tool: ${preferredTool}`);
        return this.grepWithTool(preferredTool as UnixContentSearchTool, params);
      }

      // Determine the best available tool on first search
      if (this.currentTool === null) {
        this.currentTool = await this.determineBestUnixTool();
        logger.info(`Using content search tool: ${this.currentTool}`);
      }

      return this.grepWithTool(this.currentTool, params);
    } catch (error) {
      logger.error(`${logPrefix} Grep failed:`, error);
      return {
        engine: this.currentTool || 'nodejs',
        error: (error as Error).message,
        matches: [],
        success: false,
        total_matches: 0,
      };
    }
  }

  /**
   * Search using the specified tool
   */
  protected async grepWithTool(
    tool: UnixContentSearchTool,
    params: GrepContentParams,
  ): Promise<GrepContentResult> {
    switch (tool) {
      case 'rg': {
        return this.grepWithRipgrep(params);
      }
      case 'ag': {
        return this.grepWithAg(params);
      }
      case 'grep': {
        return this.grepWithGrep(params);
      }
      default: {
        return this.grepWithNodejs(params);
      }
    }
  }

  /**
   * Grep using ripgrep (rg)
   */
  protected async grepWithRipgrep(params: GrepContentParams): Promise<GrepContentResult> {
    return this.grepWithExternalTool('rg', params);
  }

  /**
   * Grep using The Silver Searcher (ag)
   */
  protected async grepWithAg(params: GrepContentParams): Promise<GrepContentResult> {
    return this.grepWithExternalTool('ag', params);
  }

  /**
   * Grep using GNU grep
   */
  protected async grepWithGrep(params: GrepContentParams): Promise<GrepContentResult> {
    return this.grepWithExternalTool('grep', params);
  }

  /**
   * Grep using external tools (rg, ag, grep)
   */
  protected async grepWithExternalTool(
    tool: 'rg' | 'ag' | 'grep',
    params: GrepContentParams,
  ): Promise<GrepContentResult> {
    const { path: searchPath = process.cwd(), output_mode = 'files_with_matches' } = params;
    const logPrefix = `[grepContent:${tool}]`;

    try {
      const args = this.buildGrepArgs(tool, params);
      logger.debug(`${logPrefix} Executing: ${tool} ${args.join(' ')}`);

      const { stdout, stderr, exitCode } = await execa(tool, args, {
        cwd: searchPath,
        reject: false, // Don't throw on non-zero exit code
      });

      // ripgrep returns 1 when no matches found, which is not an error
      if (exitCode !== 0 && exitCode !== 1 && stderr) {
        logger.warn(`${logPrefix} Tool exited with code ${exitCode}: ${stderr}`);
      }

      const lines = stdout.trim().split('\n').filter(Boolean);
      let matches: string[] = [];
      let totalMatches = 0;

      switch (output_mode) {
        case 'files_with_matches': {
          matches = lines;
          totalMatches = lines.length;
          break;
        }
        case 'content': {
          matches = lines;
          // When context lines are used, lines.length includes context lines
          // We need to get the actual match count separately
          const hasContext = params['-A'] || params['-B'] || params['-C'];
          if (hasContext) {
            // Run a separate count query to get accurate match count
            totalMatches = await this.getActualMatchCount(tool, params);
          } else {
            totalMatches = lines.length;
          }
          break;
        }
        case 'count': {
          // Parse count output (file:count format)
          for (const line of lines) {
            const match = line.match(/:(\d+)$/);
            if (match) {
              totalMatches += parseInt(match[1], 10);
            }
          }
          matches = lines;
          break;
        }
      }

      // Apply head_limit
      if (params.head_limit && matches.length > params.head_limit) {
        matches = matches.slice(0, params.head_limit);
      }

      logger.info(`${logPrefix} Search completed`, {
        matchCount: matches.length,
        totalMatches,
      });

      return {
        engine: tool,
        matches,
        success: true,
        total_matches: totalMatches,
      };
    } catch (error) {
      logger.warn(`${logPrefix} External tool failed, falling back to next tool:`, error);
      // Fallback to next tool
      this.currentTool = await this.fallbackToNextTool(tool as UnixContentSearchTool);
      logger.info(`Falling back to: ${this.currentTool}`);
      return this.grepWithTool(this.currentTool, params);
    }
  }

  /**
   * Get actual match count for content mode when context lines are used
   */
  protected async getActualMatchCount(
    tool: 'rg' | 'ag' | 'grep',
    params: GrepContentParams,
  ): Promise<number> {
    const countParams = { ...params, '-A': undefined, '-B': undefined, '-C': undefined };
    const args = this.buildGrepArgs(tool, {
      ...countParams,
      output_mode: 'count',
    } as GrepContentParams);

    try {
      const { stdout } = await execa(tool, args, {
        cwd: params.path || process.cwd(),
        reject: false,
      });

      let total = 0;
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const match = line.match(/:(\d+)$/);
        if (match) {
          total += parseInt(match[1], 10);
        }
      }
      return total;
    } catch {
      return 0;
    }
  }
}
