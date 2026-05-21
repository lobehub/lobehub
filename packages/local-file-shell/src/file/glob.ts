import fg from 'fast-glob';

import type { GlobFilesParams, GlobFilesResult } from '../types';
import { expandTilde } from './expandTilde';
import { hasHiddenSegment } from './hasHiddenSegment';

/**
 * Lightweight glob — backed by `fast-glob` only. For the platform-aware
 * version that prefers `fd` / `find` / `mdfind` when present, use
 * `createFileSearchModule()` from `@lobechat/local-file-shell/fileSearch`.
 */
export async function globLocalFiles({
  pattern,
  cwd,
  scope,
}: GlobFilesParams): Promise<GlobFilesResult> {
  try {
    const wantsHidden = hasHiddenSegment(pattern);
    const files = await fg(pattern, {
      cwd: expandTilde(scope ?? cwd) || process.cwd(),
      dot: wantsHidden,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    const base: GlobFilesResult = {
      engine: 'fast-glob',
      files,
      success: true,
      total_files: files.length,
    };

    if (wantsHidden) {
      return {
        ...base,
        hint: `Auto-enabled hidden-file matching because pattern contains a dot-prefixed segment.`,
      };
    }
    return base;
  } catch (error) {
    return {
      engine: 'fast-glob',
      error: (error as Error).message,
      files: [],
      success: false,
      total_files: 0,
    };
  }
}
