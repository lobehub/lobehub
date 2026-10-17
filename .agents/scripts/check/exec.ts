import { spawn } from 'node:child_process';
import path from 'node:path';

import { exists, mountDir, rootDir } from './paths';
import type { RepoMount, RunResult } from './types';

const MAX_GIT_CONTEXT_LENGTH = 1000;
const MAX_GIT_STDERR_LENGTH = 2000;
const TRUNCATION_SUFFIX = '\n… [truncated]';

const redactSecrets = (value: string) =>
  value
    .replaceAll(/([a-z][a-z\d+.-]*:\/\/)[^@\s/]+@/giu, '$1[REDACTED]@')
    .replaceAll(/\b(Basic|Bearer)\s+\S+/giu, '$1 [REDACTED]')
    .replaceAll(
      /((?:^|[?&\s/])(?:access[_-]?token|api[_-]?key|password|passwd|secret|token)=)[^&\s"'\\]+/giu,
      '$1[REDACTED]',
    )
    .replaceAll(/\b(?:gh[pousr]_\w+|github_pat_\w+)\b/gu, '[REDACTED]');

const boundedDiagnostic = (value: string, maxLength: number) => {
  const redacted = redactSecrets(value.trim());
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
};

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
  if (result.code !== 0) {
    const command = boundedDiagnostic(JSON.stringify(['git', ...args]), MAX_GIT_CONTEXT_LENGTH);
    const safeCwd = boundedDiagnostic(cwd, MAX_GIT_CONTEXT_LENGTH);
    const stderr = boundedDiagnostic(result.stderr, MAX_GIT_STDERR_LENGTH) || '(empty)';
    throw new Error(
      `Git command failed with exit code ${result.code}\ncwd: ${safeCwd}\ncommand: ${command}\nstderr: ${stderr}`,
    );
  }
  return result.stdout.split('\n').filter(Boolean);
};
