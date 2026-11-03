import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type DependencyMode = 'isolated' | 'shared';

export interface Revision {
  revision: string;
  root: string;
}

export interface PreparedRevisions {
  base: Revision;
  cleanup: () => Promise<void>;
  dependencyMode: DependencyMode;
  head: Revision;
}

export interface PrepareOptions {
  base: string;
  head: string;
  install?: (root: string) => Promise<void>;
  repo: string;
  runDir: string;
}

const MANIFESTS = ['pnpm-lock.yaml', 'package.json', '**/package.json', 'pnpm-workspace.yaml'];

const git = (repo: string, args: string[]) =>
  run('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 ** 2 });

export const defaultInstall = async (root: string) => {
  const frozen = existsSync(path.join(root, 'pnpm-lock.yaml')) ? ['--frozen-lockfile'] : [];
  await run('pnpm', ['install', ...frozen, '--ignore-scripts', '--prefer-offline'], {
    cwd: root,
    maxBuffer: 64 * 1024 ** 2,
  });
};

const manifestsDiffer = async (repo: string, base: string, head: string) => {
  try {
    await git(repo, ['diff', '--quiet', base, head, '--', ...MANIFESTS]);
    return false;
  } catch (error) {
    if ((error as { code?: number }).code === 1) return true;
    throw error;
  }
};

const shareDependencies = async (repo: string, root: string) => {
  const manifests = (await git(root, ['ls-files', '--', 'package.json', '**/package.json'])).stdout
    .split('\n')
    .filter(Boolean);
  for (const manifest of manifests) {
    const directory = path.dirname(manifest);
    const source = path.join(repo, directory, 'node_modules');
    const target = path.join(root, directory, 'node_modules');
    if (existsSync(source) && !existsSync(target)) await symlink(source, target);
  }
};

export const prepareRevisions = async ({
  base,
  head,
  install = defaultInstall,
  repo,
  runDir,
}: PrepareOptions): Promise<PreparedRevisions> => {
  const created: string[] = [];
  const cleanup = async () => {
    for (const directory of created.splice(0).reverse())
      await git(repo, ['worktree', 'remove', '--force', directory]).catch(() => undefined);
    await git(repo, ['worktree', 'prune']).catch(() => undefined);
  };
  try {
    const sides = {} as Record<'base' | 'head', Revision>;
    for (const [side, revision] of [
      ['base', base],
      ['head', head],
    ] as const) {
      const root = path.join(runDir, `wt-${side}`);
      await git(repo, ['worktree', 'add', '--detach', root, revision]);
      created.push(root);
      sides[side] = { revision, root };
    }
    const dependencyMode: DependencyMode = (await manifestsDiffer(repo, base, head))
      ? 'isolated'
      : 'shared';
    for (const side of Object.values(sides)) {
      if (dependencyMode === 'shared') await shareDependencies(repo, side.root);
      else await install(side.root);
    }
    return { ...sides, cleanup, dependencyMode };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
