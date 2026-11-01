import { spawn } from 'node:child_process';

import type { GrepContentParams, GrepContentResult } from '../types';
import { expandTilde } from './expandTilde';
import { hasHiddenSegment } from './hasHiddenSegment';

/**
 * Lightweight grep — spawns `rg` directly. For the platform-aware fallback
 * chain (rg → ag → grep → nodejs) with rich `output_mode` / `-A/-B/-C` support, use
 * `createContentSearchImpl()` from `@lobechat/local-file-shell/contentSearch`.
 */
export async function grepContent({
  pattern,
  cwd,
  filePattern,
  output_mode = 'files_with_matches',
}: GrepContentParams): Promise<GrepContentResult> {
  const wantsHidden = hasHiddenSegment(filePattern);
  const hint = wantsHidden
    ? `Auto-enabled hidden-file matching because filePattern contains a dot-prefixed segment.`
    : undefined;

  return new Promise<GrepContentResult>((resolve) => {
    const args = ['--color=never', '--no-heading', '--with-filename', '--max-columns', '500'];
    if (wantsHidden) {
      args.push('--hidden', '--glob', '!**/.git/**');
    }
    if (output_mode === 'files_with_matches') {
      args.push('--files-with-matches');
    } else if (output_mode === 'count') {
      args.push('--count');
    } else {
      args.push('--line-number', '--column');
    }
    if (filePattern) args.push('--glob', filePattern);
    args.push(pattern, '.');

    const child = spawn('rg', args, {
      cwd: expandTilde(cwd) || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

      const matches = stdout.split('\n').filter(Boolean);
      const totalMatches =
        output_mode === 'count'
          ? matches.reduce((sum, line) => {
              const count = Number.parseInt(line.slice(line.lastIndexOf(':') + 1), 10);
              return sum + (Number.isNaN(count) ? 0 : count);
            }, 0)
          : matches.length;

      resolve({
        engine: 'rg',
        hint,
        matches,
        success: true,
        total_matches: totalMatches,
      });
    });

    child.on('error', () => {
      resolve({ engine: 'rg', hint, matches: [], success: false, total_matches: 0 });
    });
  });
}
