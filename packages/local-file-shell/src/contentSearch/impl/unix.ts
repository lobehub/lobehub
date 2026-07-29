import { execa } from 'execa';

import { createLogger } from '../../logger';
import type { ToolDetector } from '../../toolDetector';
import type { GrepContentParams, GrepContentResult } from '../../types';
import { BaseContentSearch } from '../base';

const logger = createLogger('contentSearch:unix');

/**
 * Unix content search tool type
 * Priority: rg (1) > ag (2) > grep (3)
 */
export type UnixContentSearchTool = 'ag' | 'grep' | 'nodejs' | 'rg';

/**
 * Unix content search base class
 * Provides common search implementations for macOS and Linux
 */
export abstract class UnixContentSearch extends BaseContentSearch {
  protected currentTool: UnixContentSearchTool | null = null;

  constructor(toolDetector?: ToolDetector) {
    super(toolDetector);
  }

  async checkToolAvailable(tool: string): Promise<boolean> {
    try {
      await execa('which', [tool], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  protected async determineBestUnixTool(): Promise<UnixContentSearchTool> {
    if (this.toolDetector) {
      const bestTool = await this.toolDetector.getBestTool('content-search');
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

  protected async fallbackToNextTool(
    currentTool: UnixContentSearchTool,
  ): Promise<UnixContentSearchTool> {
    const priority: UnixContentSearchTool[] = ['rg', 'ag', 'grep', 'nodejs'];
    const currentIndex = priority.indexOf(currentTool);

    for (let i = currentIndex + 1; i < priority.length; i++) {
      const nextTool = priority[i];
      if (nextTool === 'nodejs') {
        return 'nodejs';
      }
      if (await this.checkToolAvailable(nextTool)) {
        return nextTool;
      }
    }

    return 'nodejs';
  }

  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    const { tool: preferredTool } = params;
    const logPrefix = `[grepContent: ${params.pattern}]`;

    try {
      if (preferredTool && ['rg', 'ag', 'grep'].includes(preferredTool)) {
        logger.debug(`${logPrefix} Using preferred tool: ${preferredTool}`);
        return this.grepWithTool(preferredTool as UnixContentSearchTool, params);
      }

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

  protected async grepWithRipgrep(params: GrepContentParams): Promise<GrepContentResult> {
    return this.grepWithExternalTool('rg', params);
  }

  protected async grepWithAg(params: GrepContentParams): Promise<GrepContentResult> {
    return this.grepWithExternalTool('ag', params);
  }

  protected async grepWithGrep(params: GrepContentParams): Promise<GrepContentResult> {
    return this.grepWithExternalTool('grep', params);
  }

  protected async grepWithExternalTool(
    tool: 'ag' | 'grep' | 'rg',
    params: GrepContentParams,
  ): Promise<GrepContentResult> {
    const { output_mode = 'files_with_matches' } = params;
    const searchPath = this.resolveSearchPath(params);
    const logPrefix = `[grepContent:${tool}]`;

    try {
      const args = this.buildGrepArgs(tool, params);
      logger.debug(`${logPrefix} Executing: ${tool} ${args.join(' ')}`);

      const { stdout, stderr, exitCode } = await execa(tool, args, {
        cwd: searchPath,
        reject: false,
        stdin: 'ignore',
      });

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
          const hasContext = params['-A'] || params['-B'] || params['-C'];
          if (hasContext) {
            totalMatches = await this.getActualMatchCount(tool, params);
          } else {
            totalMatches = lines.length;
          }
          break;
        }
        case 'count': {
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
      this.currentTool = await this.fallbackToNextTool(tool as UnixContentSearchTool);
      logger.info(`Falling back to: ${this.currentTool}`);
      return this.grepWithTool(this.currentTool, params);
    }
  }

  protected async getActualMatchCount(
    tool: 'ag' | 'grep' | 'rg',
    params: GrepContentParams,
  ): Promise<number> {
    const countParams = { ...params, '-A': undefined, '-B': undefined, '-C': undefined };
    const args = this.buildGrepArgs(tool, {
      ...countParams,
      output_mode: 'count',
    } as GrepContentParams);

    try {
      const { stdout } = await execa(tool, args, {
        cwd: this.resolveSearchPath(params),
        reject: false,
        stdin: 'ignore',
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
