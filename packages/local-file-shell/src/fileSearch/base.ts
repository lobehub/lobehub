import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { ToolDetector } from '../toolDetector';
import type { FileResult, GlobFilesParams, GlobFilesResult, SearchFilesParams } from '../types';

/**
 * Content type mapping for common file extensions
 */
const CONTENT_TYPE_MAP: Record<string, string> = {
  '7z': 'archive',
  'aac': 'audio',
  'app': 'application',
  'avi': 'video',
  'bat': 'code',
  'c': 'code',
  'cmd': 'code',
  'cpp': 'code',
  'cs': 'code',
  'css': 'code',
  'deb': 'package',
  'dmg': 'disk-image',
  'doc': 'document',
  'docx': 'document',
  'exe': 'application',
  'gif': 'image',
  'gz': 'archive',
  'heic': 'image',
  'html': 'code',
  'ico': 'image',
  'iso': 'disk-image',
  'java': 'code',
  'jpeg': 'image',
  'jpg': 'image',
  'js': 'code',
  'json': 'code',
  'mkv': 'video',
  'mov': 'video',
  'mp3': 'audio',
  'mp4': 'video',
  'msi': 'installer',
  'ogg': 'audio',
  'pdf': 'document',
  'png': 'image',
  'ppt': 'presentation',
  'pptx': 'presentation',
  'ps1': 'code',
  'py': 'code',
  'rar': 'archive',
  'rpm': 'package',
  'rtf': 'text',
  'sh': 'code',
  'svg': 'image',
  'swift': 'code',
  'tar': 'archive',
  'ts': 'code',
  'tsx': 'code',
  'txt': 'text',
  'vbs': 'code',
  'wav': 'audio',
  'webp': 'image',
  'xls': 'spreadsheet',
  'xlsx': 'spreadsheet',
  'zip': 'archive',
};

/**
 * File Search Service Implementation Abstract Class
 * Defines the interface that different platform file search implementations need to implement
 */
export abstract class BaseFileSearch {
  protected toolDetector?: ToolDetector;

  constructor(toolDetector?: ToolDetector) {
    this.toolDetector = toolDetector;
  }

  setToolDetector(detector: ToolDetector): void {
    this.toolDetector = detector;
  }

  protected determineContentType(extension: string): string {
    return CONTENT_TYPE_MAP[extension.toLowerCase()] || 'unknown';
  }

  /**
   * Escape special glob characters in the search pattern
   */
  protected escapeGlobPattern(pattern: string): string {
    return pattern.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
  }

  /**
   * Process file paths and return FileResult objects
   */
  protected async processFilePaths(
    filePaths: string[],
    options: SearchFilesParams,
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

  protected sortResults(
    results: FileResult[],
    sortBy?: 'date' | 'name' | 'size',
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

  abstract search(options: SearchFilesParams): Promise<FileResult[]>;

  abstract glob(params: GlobFilesParams): Promise<GlobFilesResult>;

  abstract checkSearchServiceStatus(): Promise<boolean>;

  abstract updateSearchIndex(path?: string): Promise<boolean>;
}
