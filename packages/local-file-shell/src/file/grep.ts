import { spawn } from 'node:child_process';

import type { GrepContentParams, GrepContentResult } from '../types';

export async function grepContent({
  pattern,
  cwd,
  filePattern,
}: GrepContentParams): Promise<GrepContentResult> {
  return new Promise<GrepContentResult>((resolve) => {
    const args = ['--json', '-n'];
    if (filePattern) args.push('--glob', filePattern);
    args.push(pattern);

    const child = spawn('rg', args, { cwd: cwd || process.cwd() });
    let stdout = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', () => {
      // stderr consumed but not used
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        resolve({ matches: [], success: false });
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

        resolve({ matches, success: true });
      } catch {
        resolve({ matches: [], success: true });
      }
    });

    child.on('error', () => {
      resolve({ matches: [], success: false });
    });
  });
}
