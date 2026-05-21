import fg from 'fast-glob';

import type { GlobFilesParams, GlobFilesResult } from '../types';
import { expandTilde } from './expandTilde';
import { hasHiddenSegment } from './hasHiddenSegment';

export async function globLocalFiles({ pattern, cwd }: GlobFilesParams): Promise<GlobFilesResult> {
  try {
    // When the pattern explicitly references a dot-prefixed segment (e.g.
    // `.github/workflows/*.yml`), the caller clearly wants to traverse a
    // hidden directory — auto-enable hidden matching so it doesn't silently
    // return zero results.
    const wantsHidden = hasHiddenSegment(pattern);

    const files = await fg(pattern, {
      cwd: expandTilde(cwd) || process.cwd(),
      dot: wantsHidden,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    if (wantsHidden) {
      return {
        files,
        hint: `Auto-enabled hidden-file matching because pattern contains a dot-prefixed segment.`,
      };
    }
    return { files };
  } catch (error) {
    return { error: (error as Error).message, files: [] };
  }
}
