import { spawn } from 'node:child_process';
import path from 'node:path';

import { exists, mountDir, rootDir } from './paths';
import type { RepoMount, RunResult } from './types';

export const run = (command: string, args: string[], cwd: string): Promise<RunResult> =>
  new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolvePromise({ code: 127, stderr: String(error), stdout }));
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stderr, stdout }));
  });

/**
 * Resolve a tool to the nearest node_modules/.bin walking up to the host root.
 * No bunx fallback: downloading an unpinned copy on the fly can disagree with
 * the repo's locked version — a missing bin means deps aren't installed, which
 * should fail loudly instead.
 */
export const toolCommand = async (dir: string, tool: string): Promise<string> => {
  const root = rootDir();
  for (let current = dir; ; current = path.dirname(current)) {
    const bin = path.join(current, 'node_modules/.bin', tool);
    if (await exists(bin)) return bin;
    if (current === root || current === path.dirname(current)) break;
  }
  console.error(
    `✗ ${tool} not found in node_modules/.bin (from ${path.relative(root, dir) || '.'}) — install dependencies from the repo root first`,
  );
  process.exit(2);
};

export const runTool = async (mount: RepoMount, toolArgs: string[], files: string[]) => {
  const [tool, ...flags] = toolArgs;
  const dir = mountDir(mount);
  const bin = await toolCommand(dir, tool);
  return run(bin, [...flags, ...files], dir);
};

export const git = async (args: string[], cwd = rootDir()): Promise<string[]> => {
  const result = await run('git', args, cwd);
  return result.stdout.split('\n').filter(Boolean);
};
