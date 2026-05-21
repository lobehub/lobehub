import { spawn } from 'node:child_process';

import type { GrepContentParams, GrepContentResult } from '../types';
import { expandTilde } from './expandTilde';
import { hasHiddenSegment } from './hasHiddenSegment';

/**
 * Lightweight grep — spawns `rg` directly and returns the raw `--json`
 * events. For the platform-aware fallback chain (rg → ag → grep → nodejs)
 * with rich `output_mode` / `-A/-B/-C` support, use
 * `createContentSearchImpl()` from `@lobechat/local-file-shell/contentSearch`.
 */
export async function grepContent({
  pattern,
  cwd,
  filePattern,
}: GrepContentParams): Promise<GrepContentResult> {
  const wantsHidden = hasHiddenSegment(filePattern);
  const hint = wantsHidden
    ? `Auto-enabled hidden-file matching because filePattern contains a dot-prefixed segment.`
    : undefined;

  return new Promise<GrepContentResult>((resolve) => {
    const args = ['--json', '-n'];
    if (wantsHidden) {
      args.push('--hidden', '--glob', '!**/.git/**');
    }
    if (filePattern) args.push('--glob', filePattern);
    args.push(pattern);

    const child = spawn('rg', args, { cwd: expandTilde(cwd) || process.cwd() });
    let stdout = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', () => {
      // stderr consumed but not used
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        resolve({ engine: 'rg', hint, matches: [], success: false, total_matches: 0 });
        return;
      }

      try {
        const matches = stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        resolve({
          engine: 'rg',
          hint,
          matches,
          success: true,
          total_matches: matches.length,
        });
      } catch {
        resolve({ engine: 'rg', hint, matches: [], success: true, total_matches: 0 });
      }
    });

    child.on('error', () => {
      resolve({ engine: 'rg', hint, matches: [], success: false, total_matches: 0 });
    });
  });
}
