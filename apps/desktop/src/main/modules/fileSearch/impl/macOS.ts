import { stat } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

import type { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';
import { createLogger } from '@/utils/logger';

import type { FileResult, SearchOptions } from '../types';
import type { UnixSearchTool } from './unix';
import { UnixFileSearch } from './unix';

const logger = createLogger('module:FileSearch:macOS');

/**
 * Build the kMDItemFSName expression for a free-form keyword string.
 *
 * Splits on whitespace and ANDs each token as a case/diacritic-insensitive
 * substring match, so "Foo Bar" matches both `Bar_Foo.pdf` and `Foo Bar.pdf`
 * — instead of requiring the literal phrase "Foo Bar" to appear.
 *
 * Returns an empty string when the keywords contain no usable token.
 */
export const buildFilenameKeywordExpression = (keywords: string): string => {
  const tokens = keywords
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replaceAll('"', '\\"'));

  if (tokens.length === 0) return '';

  const term = (token: string) => `kMDItemFSName == "*${token}*"cd`;
  if (tokens.length === 1) return term(tokens[0]);
  return `(${tokens.map(term).join(' && ')})`;
};

/**
 * Fallback tool type for macOS file search
 * Priority: mdfind > fd > find > fast-glob
 */
type MacOSSearchTool = 'mdfind' | UnixSearchTool;

export class MacOSSearchServiceImpl extends UnixFileSearch {
  /**
   * Cache for Spotlight availability status
   * null = not checked, true = available, false = not available
   */
  private spotlightAvailable: boolean | null = null;

  /**
   * Current tool being used (macOS specific, includes mdfind)
   */
  private macOSCurrentTool: MacOSSearchTool | null = null;

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
    if (this.macOSCurrentTool === null) {
      this.macOSCurrentTool = await this.determineBestTool();
      logger.info(`Using file search tool: ${this.macOSCurrentTool}`);
    }

    return this.searchWithTool(this.macOSCurrentTool, options);
  }

  /**
   * Determine the best available tool based on priority
   * Priority: mdfind > fd > find > fast-glob
   */
  private async determineBestTool(): Promise<MacOSSearchTool> {
    if (this.toolDetectorManager) {
      const bestTool = await this.toolDetectorManager.getBestTool('file-search');
      if (bestTool && ['mdfind', 'fd', 'find'].includes(bestTool)) {
        return bestTool as MacOSSearchTool;
      }
    }

    if (await this.checkSpotlightStatus()) {
      return 'mdfind';
    }

    // Fallback to Unix tool detection
    return this.determineBestUnixTool();
  }

  /**
   * Search using the specified tool
   */
  private async searchWithTool(
    tool: MacOSSearchTool,
    options: SearchOptions,
  ): Promise<FileResult[]> {
    if (tool === 'mdfind') {
      return this.searchWithSpotlight(options);
    }
    // Use parent class Unix tool implementation
    return this.searchWithUnixTool(tool, options);
  }

  /**
   * Fallback to the next available tool (macOS specific)
   */
  private async fallbackFromMdfind(): Promise<MacOSSearchTool> {
    return this.determineBestUnixTool();
  }

  /**
   * Search using Spotlight (mdfind)
   */
  private async searchWithSpotlight(options: SearchOptions): Promise<FileResult[]> {
    const { cmd, args, commandString, hasQuery } = this.buildSearchCommand(options);

    // Spotlight (mdfind) requires a query expression; running it with only flags
    // (e.g. -onlyin) makes mdfind print its usage to stdout and we'd treat each
    // line as a fake file. Short-circuit to an empty result instead.
    if (!hasQuery) {
      logger.warn('Skipping mdfind: no keywords/contentContains/fileTypes/date filter provided');
      return [];
    }

    logger.debug(`Executing command: ${commandString}`);

    try {
      const { stdout, stderr, exitCode } = await execa(cmd, args, {
        reject: false,
      });

      if (stderr) {
        logger.warn(`Search stderr: ${stderr}`);
      }

      logger.debug(`Search process exited with code ${exitCode}`);

      const results = stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      // If exited with error code and we have stderr and no results, fallback
      if (exitCode !== 0 && stderr && results.length === 0) {
        if (!stderr.includes('Index is unavailable') && !stderr.includes('kMD')) {
          logger.warn(
            `Spotlight search failed with code ${exitCode}, falling back to next tool: ${stderr}`,
          );
          this.spotlightAvailable = false;
          this.macOSCurrentTool = await this.fallbackFromMdfind();
          logger.info(`Falling back to: ${this.macOSCurrentTool}`);
          return this.searchWithTool(this.macOSCurrentTool, options);
        } else {
          logger.warn(
            `Search process exited with code ${exitCode} but contained potentially ignorable errors: ${stderr}`,
          );
        }
      }

      // Apply limit
      const limitedResults =
        options.limit && results.length > options.limit ? results.slice(0, options.limit) : results;

      return this.processSpotlightResults(limitedResults, options, 'mdfind');
    } catch (error) {
      logger.error(`Search process error: ${(error as Error).message}`, error);
      this.spotlightAvailable = false;
      this.macOSCurrentTool = await this.fallbackFromMdfind();
      logger.warn(`Spotlight search failed, falling back to: ${this.macOSCurrentTool}`);
      return this.searchWithTool(this.macOSCurrentTool, options);
    }
  }

  /**
   * Get macOS-specific ignore patterns including Library/Caches
   */
  protected override getDefaultIgnorePatterns(): string[] {
    return [...super.getDefaultIgnorePatterns(), '**/Library/Caches/**'];
  }

  /**
   * Check search service status
   * @returns Promise indicating if Spotlight service is available
   */
  async checkSearchServiceStatus(): Promise<boolean> {
    return this.checkSpotlightStatus();
  }

  /**
   * Update search index
   * @param path Optional specified path
   * @returns Promise indicating operation success
   */
  async updateSearchIndex(updatePath?: string): Promise<boolean> {
    return this.updateSpotlightIndex(updatePath);
  }

  /**
   * Build mdfind command string
   */
  private buildSearchCommand(options: SearchOptions): {
    args: string[];
    cmd: string;
    commandString: string;
    hasQuery: boolean;
  } {
    const cmd = 'mdfind';
    const args: string[] = [];

    if (options.onlyIn) {
      args.push('-onlyin', options.onlyIn);
    }

    if (options.liveUpdate) {
      args.push('-live');
    }

    if (options.detailed) {
      args.push(
        '-attr',
        'kMDItemDisplayName',
        'kMDItemContentType',
        'kMDItemKind',
        'kMDItemFSSize',
        'kMDItemFSCreationDate',
        'kMDItemFSContentChangeDate',
      );
    }

    let queryExpression = '';

    if (options.keywords) {
      if (!options.keywords.includes('kMDItem')) {
        queryExpression = buildFilenameKeywordExpression(options.keywords);
      } else {
        queryExpression = options.keywords;
      }
    }

    if (options.contentContains) {
      if (queryExpression) {
        queryExpression = `${queryExpression} && kMDItemTextContent == "*${options.contentContains}*"cd`;
      } else {
        queryExpression = `kMDItemTextContent == "*${options.contentContains}*"cd`;
      }
    }

    if (options.fileTypes && options.fileTypes.length > 0) {
      const typeConditions = options.fileTypes
        .map((type) => `kMDItemContentType == "${type}"`)
        .join(' || ');
      if (queryExpression) {
        queryExpression = `${queryExpression} && (${typeConditions})`;
      } else {
        queryExpression = `(${typeConditions})`;
      }
    }

    if (options.modifiedAfter || options.modifiedBefore) {
      let dateCondition = '';

      if (options.modifiedAfter) {
        const dateString = options.modifiedAfter.toISOString().split('T')[0];
        dateCondition += `kMDItemFSContentChangeDate >= $time.iso(${dateString})`;
      }

      if (options.modifiedBefore) {
        if (dateCondition) dateCondition += ' && ';
        const dateString = options.modifiedBefore.toISOString().split('T')[0];
        dateCondition += `kMDItemFSContentChangeDate <= $time.iso(${dateString})`;
      }

      if (queryExpression) {
        queryExpression = `${queryExpression} && (${dateCondition})`;
      } else {
        queryExpression = dateCondition;
      }
    }

    if (options.createdAfter || options.createdBefore) {
      let dateCondition = '';

      if (options.createdAfter) {
        const dateString = options.createdAfter.toISOString().split('T')[0];
        dateCondition += `kMDItemFSCreationDate >= $time.iso(${dateString})`;
      }

      if (options.createdBefore) {
        if (dateCondition) dateCondition += ' && ';
        const dateString = options.createdBefore.toISOString().split('T')[0];
        dateCondition += `kMDItemFSCreationDate <= $time.iso(${dateString})`;
      }

      if (queryExpression) {
        queryExpression = `${queryExpression} && (${dateCondition})`;
      } else {
        queryExpression = dateCondition;
      }
    }

    const hasQuery = Boolean(queryExpression);

    if (hasQuery) {
      args.push(queryExpression);
    }

    const commandString = `${cmd} ${args.map((arg) => (arg.includes(' ') || arg.includes('*') ? `"${arg}"` : arg)).join(' ')}`;

    return { args, cmd, commandString, hasQuery };
  }

  /**
   * Process Spotlight search results with optional metadata
   */
  private async processSpotlightResults(
    filePaths: string[],
    options: SearchOptions,
    engine?: string,
  ): Promise<FileResult[]> {
    const resultPromises = filePaths.map(async (filePath): Promise<FileResult | null> => {
      try {
        const stats = await stat(filePath);

        const result: FileResult = {
          createdTime: stats.birthtime,
          engine,
          isDirectory: stats.isDirectory(),
          lastAccessTime: stats.atime,
          metadata: {},
          modifiedTime: stats.mtime,
          name: path.basename(filePath),
          path: filePath,
          size: stats.size,
          type: path.extname(filePath).toLowerCase().replace('.', ''),
        };

        if (options.detailed && this.spotlightAvailable) {
          result.metadata = await this.getDetailedMetadata(filePath);
        }

        result.contentType = this.determineContentType(result.type);

        return result;
      } catch (error) {
        // Drop the row instead of fabricating a 0-byte placeholder. mdfind
        // occasionally returns non-path lines (e.g. usage text when the query
        // is malformed) which would otherwise render as phantom files.
        logger.warn(`Dropping unstattable search hit ${filePath}: ${(error as Error).message}`);
        return null;
      }
    });

    let results = (await Promise.all(resultPromises)).filter((r): r is FileResult => r !== null);

    if (options.sortBy) {
      results = this.sortResults(results, options.sortBy, options.sortDirection);
    }

    if (options.limit && options.limit > 0 && results.length > options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get detailed metadata for a file using mdls
   */
  private async getDetailedMetadata(filePath: string): Promise<Record<string, any>> {
    try {
      const { stdout } = await execa('mdls', [filePath]);

      const metadata: Record<string, any> = {};
      const lines = stdout.split('\n');

      let currentKey = '';
      let isMultilineValue = false;
      let multilineValue: string[] = [];

      for (const line of lines) {
        if (isMultilineValue) {
          if (line.includes(')')) {
            multilineValue.push(line.trim());
            metadata[currentKey] = multilineValue.join(' ');
            isMultilineValue = false;
            multilineValue = [];
          } else {
            multilineValue.push(line.trim());
          }
          continue;
        }

        const keyValue = line.split(/\s+=\s+/, 2);
        if (keyValue.length === 2 && /^\w+$/.test(keyValue[0])) {
          currentKey = keyValue[0];
          const value = keyValue[1].trim();

          if (value.includes('(') && !value.includes(')')) {
            isMultilineValue = true;
            multilineValue = [value];
          } else {
            metadata[currentKey] = this.parseMetadataValue(value);
          }
        }
      }

      return metadata;
    } catch (error) {
      logger.warn(`Error getting metadata for ${filePath}: ${(error as Error).message}`);
      return {};
    }
  }

  /**
   * Parse metadata value from mdls output
   */
  private parseMetadataValue(input: string): any {
    let value = input;
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    if (value === '(null)') return null;
    if (value === 'Yes' || value === 'true') return true;
    if (value === 'No' || value === 'false') return false;

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(value)) {
      try {
        return new Date(value);
      } catch {
        return value;
      }
    }

    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      return Number(value);
    }

    return value;
  }

  /**
   * Check Spotlight service status
   */
  private async checkSpotlightStatus(): Promise<boolean> {
    if (this.spotlightAvailable !== null) {
      return this.spotlightAvailable;
    }

    try {
      const { stdout } = await execa(
        'mdfind',
        ['-name', 'test', '-onlyin', os.homedir() || '~', '-count'],
        { timeout: 5000 },
      );

      const count = parseInt(stdout.trim(), 10);
      if (Number.isNaN(count)) {
        logger.warn('Spotlight returned invalid response');
        this.spotlightAvailable = false;
        return false;
      }

      this.spotlightAvailable = true;
      return true;
    } catch (error) {
      logger.warn(`Spotlight is not available: ${(error as Error).message}`);
      this.spotlightAvailable = false;
      return false;
    }
  }

  /**
   * Update Spotlight index
   */
  private async updateSpotlightIndex(updatePath?: string): Promise<boolean> {
    try {
      await execa('mdutil', ['-E', updatePath || '/']);
      return true;
    } catch (error) {
      logger.error(`Failed to update Spotlight index: ${(error as Error).message}`);
      return false;
    }
  }
}
