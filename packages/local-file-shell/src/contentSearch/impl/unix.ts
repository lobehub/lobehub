import { stat } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import { createLogger } from '../../logger';
import type { ToolDetector } from '../../toolDetector';
import type { GrepContentParams, GrepContentResult } from '../../types';
import { BaseContentSearch } from '../base';
import { filterGitIgnoredMatches, toAbsoluteMatchLine } from '../gitIgnore';

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

  /**
   * Persist a downgrade only when the tool is genuinely gone from the system.
   *
   * A single failing call (an unreadable directory, a pattern the tool rejects)
   * used to overwrite `this.currentTool`, and since the desktop keeps one
   * instance for the whole app session every later search silently ran on the
   * Node fallback — no ignore-file support, different path shape, far slower.
   * Fall back for *this* call, but only make it stick if `rg`/`ag`/`grep`
   * really is unavailable.
   */
  private async demoteIfToolMissing(tool: UnixContentSearchTool): Promise<void> {
    if (tool === 'nodejs') return;
    if (await this.checkToolAvailable(tool)) return;
    this.currentTool = await this.fallbackToNextTool(tool);
    logger.info(`${tool} is unavailable; downgrading future searches to ${this.currentTool}`);
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

    // A `scope` pointing at a single file is a normal, documented call — but
    // it used to be fatal here, because execa's `cwd` must be a directory. The
    // resulting throw dropped the call to the Node fallback *and* poisoned the
    // cached engine for every later search. Search the file from its parent
    // directory instead.
    const searchRoot = (await this.isFile(searchPath)) ? path.dirname(searchPath) : searchPath;

    try {
      const args = this.buildGrepArgs(tool, params, this.searchTarget(searchPath, searchRoot));
      logger.debug(`${logPrefix} Executing: ${tool} ${args.join(' ')}`);

      const { stdout, stderr, exitCode } = await execa(tool, args, {
        cwd: searchRoot,
        reject: false,
        stdin: 'ignore',
      });

      if (exitCode !== 0 && exitCode !== 1 && stderr) {
        logger.warn(`${logPrefix} Tool exited with code ${exitCode}: ${stderr}`);
      }

      // Normalise to absolute before anything else looks at these lines, so the
      // caller gets the same path shape the Node fallback produces.
      const lines = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => toAbsoluteMatchLine(searchRoot, line));
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
            totalMatches = await this.getActualMatchCount(
              tool,
              params,
              searchRoot,
              this.searchTarget(searchPath, searchRoot),
            );
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

      // `rg`/`ag` already honour ignore files; `grep` has no such notion, so
      // filter its output through git to match what the other engines return.
      if (tool === 'grep') {
        matches = await filterGitIgnoredMatches(searchRoot, matches);
        totalMatches = Math.min(totalMatches, matches.length);
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
      await this.demoteIfToolMissing(tool as UnixContentSearchTool);
      const next = await this.fallbackToNextTool(tool as UnixContentSearchTool);
      logger.info(`Falling back to: ${next} (for this call)`);
      return this.grepWithTool(next, params);
    }
  }

  private async isFile(target: string): Promise<boolean> {
    try {
      return (await stat(target)).isFile();
    } catch {
      return false;
    }
  }

  /** `.` for a directory search; the file's own name when `scope` names a file. */
  private searchTarget(searchPath: string, searchRoot: string): string {
    return searchPath === searchRoot ? '.' : `./${path.basename(searchPath)}`;
  }

  /**
   * `searchRoot`/`target` must be the same pair the main search ran with: a
   * file-valued `scope` is legal, but execa's `cwd` must be a directory, so
   * running the count from the raw scope used to throw and silently return 0 —
   * the summary then said "Found 0 matches" above output that plainly contained
   * the match lines.
   */
  protected async getActualMatchCount(
    tool: 'ag' | 'grep' | 'rg',
    params: GrepContentParams,
    searchRoot: string,
    target: string,
  ): Promise<number> {
    const countParams = { ...params, '-A': undefined, '-B': undefined, '-C': undefined };
    const args = this.buildGrepArgs(
      tool,
      {
        ...countParams,
        output_mode: 'count',
      } as GrepContentParams,
      target,
    );

    try {
      const { stdout } = await execa(tool, args, {
        cwd: searchRoot,
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
