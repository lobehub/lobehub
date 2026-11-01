import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { run } from './exec';
import { exists } from './paths';

/**
 * When this repo is mounted as a git submodule of a superproject that ships
 * its own `check` script, return that superproject's root so the standalone
 * entry can delegate — the host entry routes this repo's files through the
 * same engine with the host's full config, so both entries behave
 * identically no matter where they are invoked from. Ask Git about the
 * containing checkout: shared git metadata may belong to another worktree.
 */
export const detectHostCheckRoot = async (repoRoot: string): Promise<string | null> => {
  const result = await run('git', ['rev-parse', '--show-superproject-working-tree'], repoRoot);
  if (result.code !== 0) return null;
  const hostRoot = result.stdout.trim();
  if (!hostRoot) return null;

  try {
    const pkg = JSON.parse(await readFile(path.join(hostRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts?.check ? hostRoot : null;
  } catch {
    return null;
  }
};

/**
 * A check entry owns its checkout's configuration and tool versions. Refuse
 * a foreign entry before autofix or type-check can target another worktree;
 * an explicitly mounted repository within the same host remains valid.
 * A wrong checkout is a CLI usage error, so exit without a crash stack.
 */
export const assertCheckRoot = async (rootDir: string, mountedDirs: string[] = []) => {
  const result = await run('git', ['rev-parse', '--show-toplevel'], process.cwd());
  if (result.code !== 0) {
    console.error('✗ Run `bun run check` from the target Git checkout.');
    process.exit(2);
  }

  const currentRoot = await realpath(result.stdout.trim());
  for (const dir of ['', ...mountedDirs]) {
    const allowedRoot = path.resolve(rootDir, dir);
    if ((await exists(allowedRoot)) && (await realpath(allowedRoot)) === currentRoot) return;
  }

  console.error(
    `✗ This check entry belongs to ${rootDir}, but the current checkout is ${currentRoot}. ` +
      "Run `bun run check` using the target checkout's own entrypoint.",
  );
  process.exit(2);
};
