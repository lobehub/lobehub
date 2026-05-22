import { readFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import type { SearchFilesParams, SearchFilesResult } from '../types';
import { expandTilde } from './expandTilde';

/**
 * Lightweight filename search — backed by `fast-glob` only. For the
 * platform-aware version that prefers Spotlight (`mdfind`) on macOS and
 * `fd` / `find` elsewhere, use `createFileSearchModule()` from
 * `@lobechat/local-file-shell/fileSearch`.
 */
export async function searchLocalFiles({
  keywords,
  directory,
  onlyIn,
  contentContains,
  limit = 30,
}: SearchFilesParams): Promise<SearchFilesResult[]> {
  try {
    const cwd = expandTilde(onlyIn ?? directory) || process.cwd();
    // If the caller is searching for a dot-prefixed name (e.g. `.env`, `.github`),
    // auto-enable hidden matching so the file/directory is actually reachable.
    const wantsHidden = keywords.startsWith('.');
    const files = await fg(`**/*${keywords}*`, {
      cwd,
      dot: wantsHidden,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    let results: SearchFilesResult[] = files.map((f) => ({
      name: path.basename(f),
      path: path.join(cwd, f),
    }));

    if (contentContains) {
      const filtered: SearchFilesResult[] = [];
      for (const file of results) {
        try {
          const content = await readFile(file.path, 'utf8');
          if (content.includes(contentContains)) {
            filtered.push(file);
          }
        } catch {
          // Skip unreadable files
        }
      }
      results = filtered;
    }

    return results.slice(0, limit);
  } catch {
    return [];
  }
}
