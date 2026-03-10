import { stat } from 'node:fs/promises';
import * as path from 'node:path';

import type { GlobFilesParams, GlobFilesResult } from '@lobechat/electron-client-ipc';

import type { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';

import type { FileResult, SearchOptions } from './types';

/**
 * Content type mapping for common file extensions
 */
const CONTENT_TYPE_MAP: Record<string, string> = {
  // Archive
  '7z': 'archive',
  'gz': 'archive',
  'rar': 'archive',
  'tar': 'archive',
  'zip': 'archive',
  // Audio
  'aac': 'audio',
  'mp3': 'audio',
  'ogg': 'audio',
  'wav': 'audio',
  // Video
  'avi': 'video',
  'mkv': 'video',
  'mov': 'video',
  'mp4': 'video',
  // Image
  'gif': 'image',
  'heic': 'image',
  'ico': 'image',
  'jpeg': 'image',
  'jpg': 'image',
  'png': 'image',
  'svg': 'image',
  'webp': 'image',
  // Document
  'doc': 'document',
  'docx': 'document',
  'pdf': 'document',
  'rtf': 'text',
  'txt': 'text',
  // Spreadsheet
  'xls': 'spreadsheet',
  'xlsx': 'spreadsheet',
  // Presentation
  'ppt': 'presentation',
  'pptx': 'presentation',
  // Code
  'bat': 'code',
  'c': 'code',
  'cmd': 'code',
  'cpp': 'code',
  'cs': 'code',
  'css': 'code',
  'html': 'code',
  'java': 'code',
  'js': 'code',
  'json': 'code',
  'ps1': 'code',
  'py': 'code',
  'sh': 'code',
  'swift': 'code',
  'ts': 'code',
  'tsx': 'code',
  'vbs': 'code',
  // Application/Installer (platform-specific)
  'app': 'application',
  'deb': 'package',
  'dmg': 'disk-image',
  'exe': 'application',
  'iso': 'disk-image',
  'msi': 'installer',
  'rpm': 'package',
};

/**
 * File Search Service Implementation Abstract Class
 * Defines the interface that different platform file search implementations need to implement
 */
export abstract class BaseFileSearch {
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
   * Determine content type from file extension
   * @param extension File extension (without dot)
   * @returns Content type description
   */
  protected determineContentType(extension: string): string {
    return CONTENT_TYPE_MAP[extension.toLowerCase()] || 'unknown';
  }

  /**
   * Escape special glob characters in the search pattern
   * @param pattern The pattern to escape
   * @returns Escaped pattern safe for glob matching
   */
  protected escapeGlobPattern(pattern: string): string {
    return pattern.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
  }

  /**
   * Process file paths and return FileResult objects
   * @param filePaths Array of file path strings
   * @param options Search options
   * @param engine Optional search engine identifier
   * @returns Formatted file result list
   */
  protected async processFilePaths(
    filePaths: string[],
    options: SearchOptions,
    engine?: string,
  ): Promise<FileResult[]> {
    const results: FileResult[] = [];

    for (const filePath of filePaths) {
      try {
        const stats = await stat(filePath);
        const ext = path.extname(filePath).toLowerCase().replace('.', '');

        results.push({
          contentType: this.determineContentType(ext),
          createdTime: stats.birthtime,
          engine,
          isDirectory: stats.isDirectory(),
          lastAccessTime: stats.atime,
          metadata: {},
          modifiedTime: stats.mtime,
          name: path.basename(filePath),
          path: filePath,
          size: stats.size,
          type: ext,
        });
      } catch {
        // Skip files that can't be accessed
      }
    }

    return this.sortResults(results, options.sortBy, options.sortDirection);
  }

  /**
   * Sort results based on options
   * @param results Result list
   * @param sortBy Sort field
   * @param direction Sort direction
   * @returns Sorted result list
   */
  protected sortResults(
    results: FileResult[],
    sortBy?: 'name' | 'date' | 'size',
    direction: 'asc' | 'desc' = 'asc',
  ): FileResult[] {
    if (!sortBy) return results;

    return [...results].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name': {
          comparison = a.name.localeCompare(b.name);
          break;
        }
        case 'date': {
          comparison = a.modifiedTime.getTime() - b.modifiedTime.getTime();
          break;
        }
        case 'size': {
          comparison = a.size - b.size;
          break;
        }
      }
      return direction === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Perform file search
   * @param options Search options
   * @returns Promise of search result list
   */
  abstract search(options: SearchOptions): Promise<FileResult[]>;

  /**
   * Perform glob pattern matching
   * @param params Glob parameters
   * @returns Promise of glob result
   */
  abstract glob(params: GlobFilesParams): Promise<GlobFilesResult>;

  /**
   * Check search service status
   * @returns Promise indicating if service is available
   */
  abstract checkSearchServiceStatus(): Promise<boolean>;

  /**
   * Update search index
   * @param path Optional specified path
   * @returns Promise indicating operation success
   */
  abstract updateSearchIndex(path?: string): Promise<boolean>;
}
