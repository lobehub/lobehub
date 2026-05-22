import { spawn } from 'node:child_process';

import type { GrepContentParams, GrepContentResult } from '../types';
import { expandTilde } from './expandTilde';
import { hasHiddenSegment } from './hasHiddenSegment';

export async function grepContent({
  pattern,
  cwd,
  filePattern,
}: GrepContentParams): Promise<GrepContentResult> {
  // When the filePattern explicitly references a dot-prefixed segment, the
  // caller wants to scan inside a hidden directory — pass `--hidden` to rg so
  // it doesn't silently skip these paths. We still rely on rg's built-in
  // `.git/` exclusion via .gitignore semantics, plus add an explicit guard.
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
        resolve({ hint, matches: [], success: false });
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

        resolve({ hint, matches, success: true });
      } catch {
        resolve({ hint, matches: [], success: true });
      }
    });

    child.on('error', () => {
      resolve({ hint, matches: [], success: false });
    });
  });
}
