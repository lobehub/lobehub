import path from 'node:path';

import { execa } from 'execa';

import { createLogger } from '../../logger';
import type { ToolDetector } from '../../toolDetector';
import type { GrepContentParams, GrepContentResult } from '../../types';
import { BaseContentSearch } from '../base';
import { toAbsoluteMatchLine } from '../gitIgnore';

const logger = createLogger('contentSearch:windows');

/**
 * Windows content search tool type
 * Priority: rg > nodejs
 *
 * There is deliberately no findstr tier. It was run as
 * `cmd /c findstr /R "<pattern>" *.*`: libuv escapes the embedded quotes to `\"`,
 * cmd.exe strips only the outer pair, and findstr then searched for the literal
 * `"<pattern>"` — so nearly every search on a machine without `rg` answered
 * "0 matches". Even correctly quoted, findstr has no `|` alternation, no
 * `\d`/`\s`/`+`/`{n}`, reads files in the OEM code page (no UTF-8 CJK) and
 * cannot take a glob, so the Node engine is the only faithful fallback.
 */
type WindowsContentSearchTool = 'nodejs' | 'rg';

/**
 * Windows content search implementation
 * Uses rg > nodejs fallback strategy
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

    return 'nodejs';
  }

  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    const { tool: preferredTool } = params;
    const logPrefix = `[grepContent: ${params.pattern}]`;

    const missingScope = await this.missingScopeResult(params);
    if (missingScope) {
      logger.warn(`${logPrefix} ${missingScope.error}`);
      return missingScope;
    }

    try {
      if (preferredTool === 'rg') {
        if (await this.checkToolAvailable('rg')) {
          logger.debug(`${logPrefix} Using preferred tool: rg`);
          return await this.grepWithRipgrep(params);
        }
        logger.warn(`${logPrefix} ripgrep (rg) not available, falling back to other tools`);
      }

      if (this.currentTool === null) {
        this.currentTool = await this.determineBestTool();
        logger.info(`Using content search tool: ${this.currentTool}`);
      }

      // `await` so a rejected search (e.g. the Node engine's `new RegExp` on an
      // invalid pattern) lands in the catch below instead of escaping as a
      // thrown IPC error.
      return await this.grepWithTool(this.currentTool, params);
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
      default: {
        return this.grepWithNodejs(params);
      }
    }
  }

  private async grepWithRipgrep(params: GrepContentParams): Promise<GrepContentResult> {
    const { output_mode = 'files_with_matches' } = params;
    const searchPath = this.resolveSearchPath(params);
    const logPrefix = `[grepContent:rg]`;

    // `scope` may name a single file, but a process `cwd` must be a directory:
    // search the file from its parent, the same way the unix impl does.
    const searchRoot = (await this.isFile(searchPath)) ? path.dirname(searchPath) : searchPath;
    const target = this.searchTarget(searchPath, searchRoot);

    try {
      const args = this.buildGrepArgs('rg', params, target);
      logger.debug(`${logPrefix} Executing: rg ${args.join(' ')}`);

      const { stdout, stderr, exitCode, shortMessage } = await execa('rg', args, {
        cwd: searchRoot,
        reject: false,
        stdin: 'ignore',
      });

      // With `reject: false`, a process that never started (ENOENT, EACCES, a
      // bad cwd) still resolves — only without an exit code. Treating that as
      // empty output is how a missing engine used to read as "0 matches".
      if (exitCode === undefined) {
        throw new Error(shortMessage || 'rg failed to start');
      }

      // rg exits 2 on errors. With matches in hand those are partial (an
      // unreadable file), but with none there is no answer to give — report the
      // error rather than a "no matches" the search never established.
      if (exitCode > 1 && !stdout.trim()) {
        const error = `rg exited with code ${exitCode}: ${stderr.trim().split('\n').slice(0, 5).join('\n')}`;
        logger.warn(`${logPrefix} ${error}`);
        return { engine: 'rg', error, matches: [], success: false, total_matches: 0 };
      }

      if (exitCode !== 0 && exitCode !== 1 && stderr) {
        logger.warn(`${logPrefix} rg exited with code ${exitCode}: ${stderr}`);
      }

      // Same normalisation as the unix impl: rg runs with `cwd = searchRoot`
      // and searches a relative target, so its output is relative — make it
      // absolute so the engine no longer decides the path shape callers receive.
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
            totalMatches = await this.getActualMatchCount(params, searchRoot, target);
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
      logger.warn(`${logPrefix} rg failed, falling back to Node.js:`, error);
      // Only pin later searches to Node when rg is really gone; one failing
      // call should not downgrade the shared instance for the whole session.
      if (!(await this.checkToolAvailable('rg'))) this.currentTool = 'nodejs';
      return this.grepWithNodejs(params);
    }
  }

  private async getActualMatchCount(
    params: GrepContentParams,
    searchRoot: string,
    target: string,
  ): Promise<number> {
    const countParams = { ...params, '-A': undefined, '-B': undefined, '-C': undefined };
    const args = this.buildGrepArgs(
      'rg',
      {
        ...countParams,
        output_mode: 'count',
      } as GrepContentParams,
      target,
    );

    try {
      const { stdout } = await execa('rg', args, {
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

  protected override getDefaultIgnorePatterns(): string[] {
    return [
      ...super.getDefaultIgnorePatterns(),
      '**/AppData/Local/Temp/**',
      '**/AppData/Local/Microsoft/**',
      '**/$Recycle.Bin/**',
    ];
  }
}
