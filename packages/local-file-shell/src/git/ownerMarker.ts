import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The creation receipt: when the app creates a worktree for a conversation it
 * writes a random owner token into the worktree's own git admin dir
 * (`<common git dir>/worktrees/<name>/`), which only the device can read. A
 * cleanup must present the same token, so a topic that merely claims a path —
 * its metadata is client-written — can never delete another topic's worktree.
 */
export const OWNER_MARKER_FILE = 'lobehub-owner';
const OWNER_TOKEN_PATTERN = /^[\w-]{16,128}$/;

export const isValidOwnerToken = (token: unknown): token is string =>
  typeof token === 'string' && OWNER_TOKEN_PATTERN.test(token);

const worktreeAdminDir = async (worktreePath: string) =>
  (
    await execFileAsync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: worktreePath,
      timeout: 15_000,
    })
  ).stdout.trim();

export const writeOwnerMarker = async (worktreePath: string, token: string) => {
  if (!isValidOwnerToken(token)) throw new Error('Invalid owner token');
  await writeFile(path.join(await worktreeAdminDir(worktreePath), OWNER_MARKER_FILE), token);
};

export const readOwnerMarker = async (worktreePath: string): Promise<string | undefined> => {
  const file = path.join(await worktreeAdminDir(worktreePath), OWNER_MARKER_FILE);
  return existsSync(file) ? (await readFile(file, 'utf8')).trim() : undefined;
};
