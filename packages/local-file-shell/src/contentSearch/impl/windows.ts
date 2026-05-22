import { execa } from 'execa';

import { createLogger } from '../../logger';
import type { ToolDetector } from '../../toolDetector';
import type { GrepContentParams, GrepContentResult } from '../../types';
import { BaseContentSearch } from '../base';

const logger = createLogger('contentSearch:windows');

/**
 * Windows content search tool type
 * Priority: rg > findstr/powershell > nodejs
 */
type WindowsContentSearchTool = 'findstr' | 'nodejs' | 'rg';

/**
 * Windows content search implementation
 * Uses rg > findstr > nodejs fallback strategy
 */
export class WindowsContentSearchImpl extends BaseContentSearch {
  private currentTool: WindowsContentSearchTool | null = null;

  constructor(toolDetector?: ToolDetector) {
    super(toolDetector);
    logger.debug('WindowsContentSearchImpl initialized');
  }

  async checkToolAvailable(tool: string): Promise<boolean> {
    try {
      await execa('where', [tool], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  private async determineBestTool(): Promise<WindowsContentSearchTool> {
    if (this.toolDetector) {
      const bestTool = await this.toolDetector.getBestTool('content-search');
      if (bestTool === 'rg') {
        return 'rg';
      }
    }

    if (await this.checkToolAvailable('rg')) {
      return 'rg';
    }

    // findstr is always available on Windows
    return 'findstr';
  }

  private async fallbackToNextTool(
    currentTool: WindowsContentSearchTool,
  ): Promise<WindowsContentSearchTool> {
    const priority: WindowsContentSearchTool[] = ['rg', 'findstr', 'nodejs'];
    const currentIndex = priority.indexOf(currentTool);

    for (let i = currentIndex + 1; i < priority.length; i++) {
      const nextTool = priority[i];
      if (nextTool === 'nodejs' || nextTool === 'findstr') {
        return nextTool;
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
      if (preferredTool === 'rg') {
        if (await this.checkToolAvailable('rg')) {
          logger.debug(`${logPrefix} Using preferred tool: rg`);
          return this.grepWithRipgrep(params);
        }
        logger.warn(`${logPrefix} ripgrep (rg) not available, falling back to other tools`);
      }

      if (this.currentTool === null) {
        this.currentTool = await this.determineBestTool();
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

  private async grepWithTool(
    tool: WindowsContentSearchTool,
    params: GrepContentParams,
  ): Promise<GrepContentResult> {
    switch (tool) {
      case 'rg': {
        return this.grepWithRipgrep(params);
      }
      case 'findstr': {
        return this.grepWithFindstr(params);
      }
      default: {
        return this.grepWithNodejs(params);
      }
    }
  }

  private async grepWithRipgrep(params: GrepContentParams): Promise<GrepContentResult> {
    const { output_mode = 'files_with_matches' } = params;
    const searchPath = this.resolveSearchPath(params);
    const logPrefix = `[grepContent:rg]`;

    try {
      const args = this.buildGrepArgs('rg', params);
      logger.debug(`${logPrefix} Executing: rg ${args.join(' ')}`);

      const { stdout, stderr, exitCode } = await execa('rg', args, {
        cwd: searchPath,
        reject: false,
      });

      if (exitCode !== 0 && exitCode !== 1 && stderr) {
        logger.warn(`${logPrefix} rg exited with code ${exitCode}: ${stderr}`);
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
            totalMatches = await this.getActualMatchCount(params);
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
        engine: 'rg',
        matches,
        success: true,
        total_matches: totalMatches,
      };
    } catch (error) {
      logger.warn(`${logPrefix} rg failed, falling back to findstr:`, error);
      this.currentTool = await this.fallbackToNextTool('rg');
      return this.grepWithTool(this.currentTool, params);
    }
  }

  private async getActualMatchCount(params: GrepContentParams): Promise<number> {
    const countParams = { ...params, '-A': undefined, '-B': undefined, '-C': undefined };
    const args = this.buildGrepArgs('rg', {
      ...countParams,
      output_mode: 'count',
    } as GrepContentParams);

    try {
      const { stdout } = await execa('rg', args, {
        cwd: this.resolveSearchPath(params),
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

  private async grepWithFindstr(params: GrepContentParams): Promise<GrepContentResult> {
    const { pattern, output_mode = 'files_with_matches' } = params;
    const searchPath = this.resolveSearchPath(params);
    const logPrefix = `[grepContent:findstr]`;

    try {
      const args: string[] = ['/S'];

      if (params['-i']) {
        args.push('/I');
      }

      if (params['-n']) {
        args.push('/N');
      }

      args.push('/R');
      args.push(`"${pattern}"`);

      const filePattern = params.glob || params.type ? `*.${params.type || '*'}` : '*.*';
      args.push(filePattern);

      logger.debug(`${logPrefix} Executing: findstr ${args.join(' ')}`);

      const { stdout, exitCode } = await execa('cmd', ['/c', `findstr ${args.join(' ')}`], {
        cwd: searchPath,
        reject: false,
      });

      if (exitCode !== 0 && exitCode !== 1) {
        logger.warn(`${logPrefix} findstr exited with code ${exitCode}`);
      }

      const lines = stdout.trim().split('\r\n').filter(Boolean);
      let matches: string[] = [];
      let totalMatches = 0;

      switch (output_mode) {
        case 'files_with_matches': {
          const files = new Set<string>();
          for (const line of lines) {
            const match = line.match(/^([^:]+):/);
            if (match) {
              files.add(match[1]);
            }
          }
          matches = [...files];
          totalMatches = matches.length;
          break;
        }
        case 'content': {
          matches = lines;
          totalMatches = lines.length;
          break;
        }
        case 'count': {
          const fileCounts = new Map<string, number>();
          for (const line of lines) {
            const match = line.match(/^([^:]+):/);
            if (match) {
              fileCounts.set(match[1], (fileCounts.get(match[1]) || 0) + 1);
            }
          }
          matches = [...fileCounts.entries()].map(([file, count]) => `${file}:${count}`);
          totalMatches = lines.length;
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
        engine: 'findstr',
        matches,
        success: true,
        total_matches: totalMatches,
      };
    } catch (error) {
      logger.warn(`${logPrefix} findstr failed, falling back to Node.js:`, error);
      this.currentTool = 'nodejs';
      return this.grepWithNodejs(params);
    }
  }

  protected override getDefaultIgnorePatterns(): string[] {
    return [
      ...super.getDefaultIgnorePatterns(),
      '**/AppData/Local/Temp/**',
      '**/AppData/Local/Microsoft/**',
      '**/$Recycle.Bin/**',
    ];
  }
}
