import { readFile, stat } from 'node:fs/promises';

import fg from 'fast-glob';

import { expandTilde } from '../file/expandTilde';
import { isMissingPath } from '../file/isMissingPath';
import { createLogger } from '../logger';
import type { ToolDetector } from '../toolDetector';
import type { GrepContentParams, GrepContentResult } from '../types';
import { filterGitIgnored } from './gitIgnore';

const logger = createLogger('contentSearch:base');

/**
 * Directories excluded unconditionally, regardless of what the repo ignores.
 *
 * Deliberately limited to two names that are never checked in. It is tempting to
 * add the usual build output here (`dist`, `build`, `out`, `.next`, …), but those
 * names are only *usually* generated: this repo tracks
 * `apps/desktop/build/entitlements.mac.plist`, and `rg`'s `--glob` overrides all
 * ignore logic, so a hardcoded `!**\/build\/**` silently makes tracked files
 * unfindable on every engine.
 *
 * What actually belongs out of the results is "whatever git ignores", and
 * `filterGitIgnored` answers that exactly — including this repo's `.next`. Guess
 * nothing here; ask git there.
 *
 * Entries are matched relative to the search root, so explicitly scoping a
 * search *into* one of these directories still works.
 */
const EXCLUDED_DIRS = ['node_modules', '.git'] as const;

/**
 * Content search tool type
 */
export type ContentSearchTool = 'ag' | 'grep' | 'nodejs' | 'rg';

/**
 * Content Search Service Implementation Abstract Class
 * Defines the interface that different platform content search implementations need to implement
 */
export abstract class BaseContentSearch {
  protected toolDetector?: ToolDetector;

  constructor(toolDetector?: ToolDetector) {
    this.toolDetector = toolDetector;
  }

  setToolDetector(detector: ToolDetector): void {
    this.toolDetector = detector;
  }

  abstract grep(params: GrepContentParams): Promise<GrepContentResult>;

  abstract checkToolAvailable(tool: string): Promise<boolean>;

  /**
   * Resolve the directory to run the search in.
   *
   * The builtin-tool manifest documents `scope`, while the legacy type also accepts
   * `path` / `cwd`. Read all so an agent calling with `scope` (per the manifest)
   * doesn't silently fall through to `process.cwd()` — which in a packaged
   * Electron app isn't the project root and therefore has no `.gitignore` for
   * ripgrep to honor.
   */
  protected resolveSearchPath(params: GrepContentParams): string {
    return params.path ?? params.scope ?? params.cwd ?? process.cwd();
  }

  /**
   * The result to return when `scope` points at nothing.
   *
   * Every engine answers a non-existent search root with "no matches": `rg` gets
   * an unusable `cwd` and produces empty stdout, the Node fallback throws and is
   * swallowed by the caller's catch. An agent that mistypes a directory
   * (`src/locales` instead of `locales/`) therefore reads "Found 0 matches" and
   * concludes the CODE doesn't exist — the one answer the search cannot support.
   * Report the missing scope by name so the next call fixes the path instead of
   * the hypothesis.
   *
   * Only a path that is definitively absent short-circuits: a scope that exists
   * but cannot be stat'd (an unreadable parent, a transient fd exhaustion) still
   * goes to the engine, whose own error is the accurate one. Claiming "does not
   * exist" there would be a confidently wrong diagnosis — exactly what this
   * guard exists to remove.
   */
  protected async missingScopeResult(
    params: GrepContentParams,
  ): Promise<GrepContentResult | undefined> {
    const searchPath = expandTilde(this.resolveSearchPath(params))!;
    if (!(await isMissingPath(searchPath))) return undefined;

    return {
      error: `Search scope does not exist: ${searchPath}`,
      matches: [],
      success: false,
      total_matches: 0,
    };
  }

  /**
   * Build command-line arguments for grep tools.
   *
   * `target` is what the tool is pointed at, resolved *relative to the cwd the
   * caller will run it in* — `.` for a directory search, `./<file>` when `scope`
   * names a single file. It must stay relative: an absolute target would be
   * matched by the `EXCLUDED_DIRS` globs below, so deliberately searching inside
   * e.g. `dist/` would return nothing.
   */
  protected buildGrepArgs(
    tool: 'ag' | 'grep' | 'rg',
    params: GrepContentParams,
    target = '.',
  ): string[] {
    const { pattern, output_mode = 'files_with_matches' } = params;
    const args: string[] = [];

    // Every one of these tools drops the filename prefix when handed a single
    // file, which would emit bare `12:text` lines the caller cannot attribute to
    // a path. Force it back on so a file-scoped search stays parseable — and
    // stays consistent with the Node fallback, which always prefixes.
    const singleFile = target !== '.';

    // When the caller's glob references a dot-prefixed segment (e.g.
    // `.github/workflows/*.yml`), rg and ag both default to skipping hidden
    // paths and would silently return zero results. `.git/` is still excluded
    // explicitly below.
    const wantsHidden = !!params.glob && /(?:^|\/)\.[^./]/.test(params.glob);

    switch (tool) {
      case 'rg': {
        if (singleFile) args.push('-H');
        if (params['-i']) args.push('-i');
        if (params['-n']) args.push('-n');
        if (params['-A']) args.push('-A', String(params['-A']));
        if (params['-B']) args.push('-B', String(params['-B']));
        if (params['-C']) args.push('-C', String(params['-C']));
        if (params.multiline) args.push('-U');
        if (wantsHidden) args.push('--hidden');
        if (params.glob) args.push('-g', params.glob);
        if (params.type) args.push('-t', params.type);

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

        for (const dir of EXCLUDED_DIRS) args.push('--glob', `!**/${dir}/**`);
        args.push(pattern, target);
        break;
      }

      case 'ag': {
        if (singleFile) args.push('--filename');
        if (params['-i']) args.push('-i');
        if (params['-A']) args.push('-A', String(params['-A']));
        if (params['-B']) args.push('-B', String(params['-B']));
        if (params['-C']) args.push('-C', String(params['-C']));
        if (wantsHidden) args.push('--hidden');
        if (params.glob) args.push('-G', params.glob);

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

        for (const dir of EXCLUDED_DIRS) args.push('--ignore-dir', dir);
        args.push(pattern, target);
        break;
      }

      case 'grep': {
        args.push('-r');
        if (singleFile) args.push('-H');
        if (params['-i']) args.push('-i');
        if (params['-n']) args.push('-n');
        if (params['-A']) args.push('-A', String(params['-A']));
        if (params['-B']) args.push('-B', String(params['-B']));
        if (params['-C']) args.push('-C', String(params['-C']));
        if (params.glob) args.push('--include', params.glob);
        if (params.type) args.push('--include', `*.${params.type}`);

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

        for (const dir of EXCLUDED_DIRS) args.push('--exclude-dir', dir);
        args.push('-E', pattern, target);
        break;
      }
    }

    return args;
  }

  /**
   * Grep using Node.js native implementation (fallback)
   */
  protected async grepWithNodejs(params: GrepContentParams): Promise<GrepContentResult> {
    const { pattern, output_mode = 'files_with_matches' } = params;
    const searchPath = this.resolveSearchPath(params);
    const logPrefix = `[grepContent:nodejs]`;

    const flags = `${params['-i'] ? 'i' : ''}${params.multiline ? 's' : ''}`;
    const regex = new RegExp(pattern, flags);

    let filesToSearch: string[];
    const stats = await stat(searchPath);

    if (stats.isFile()) {
      filesToSearch = [searchPath];
    } else {
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

      if (params.type) {
        const ext = `.${params.type}`;
        filesToSearch = filesToSearch.filter((file) => file.endsWith(ext));
      }

      // `EXCLUDED_DIRS` above keeps traversal cheap; this drops whatever else the
      // repo ignores (`*.log`, generated fixtures, …) so the Node fallback answers
      // the same question `rg` would. Filtering the file list rather than the
      // match list also avoids reading files we are about to discard.
      filesToSearch = await filterGitIgnored(searchPath, filesToSearch);
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
    return EXCLUDED_DIRS.map((dir) => `**/${dir}/**`);
  }
}
