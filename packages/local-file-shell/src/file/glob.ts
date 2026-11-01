import fg from 'fast-glob';

import type { GlobFilesParams, GlobFilesResult } from '../types';
import { expandTilde } from './expandTilde';
import { hasHiddenSegment } from './hasHiddenSegment';
import { isMissingPath } from './isMissingPath';

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
  // `fast-glob` answers a non-existent root with an empty list, which reads as
  // "the pattern matched nothing" — the caller then revises the pattern instead
  // of the path. Name the missing scope; a root that merely cannot be stat'd is
  // left for `fg` to fail on, since only it knows what actually went wrong.
  const searchRoot = expandTilde(scope ?? cwd);
  if (searchRoot && (await isMissingPath(searchRoot))) {
    return {
      engine: 'fast-glob',
      error: `Search scope does not exist: ${searchRoot}`,
      files: [],
      success: false,
      total_files: 0,
    };
  }

  try {
    const wantsHidden = hasHiddenSegment(pattern);
    const files = await fg(pattern, {
      cwd: searchRoot || process.cwd(),
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
