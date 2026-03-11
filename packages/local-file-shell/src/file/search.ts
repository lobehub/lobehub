import { readFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import type { SearchFilesParams, SearchFilesResult } from '../types';

export async function searchLocalFiles({
  keywords,
  directory,
  contentContains,
  limit = 30,
}: SearchFilesParams): Promise<SearchFilesResult[]> {
  try {
    const cwd = directory || process.cwd();
    const files = await fg(`**/*${keywords}*`, {
      cwd,
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    let results = files.map((f) => ({ name: path.basename(f), path: path.join(cwd, f) }));

    if (contentContains) {
      const filtered: typeof results = [];
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
