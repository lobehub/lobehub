import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Browser } from '@playwright/test';

import { DEFAULT_MUTATIONS, runComparison, type RunResult } from '../run';
import { STYLE_FACTORY } from '../source/scope';

const exec = promisify(execFile);

const IDENTITY = {
  GIT_AUTHOR_EMAIL: 'style-equivalence@localhost',
  GIT_AUTHOR_NAME: 'style-equivalence',
  GIT_COMMITTER_EMAIL: 'style-equivalence@localhost',
  GIT_COMMITTER_NAME: 'style-equivalence',
};

const git = async (cwd: string, args: string[]) =>
  (
    await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      env: { ...process.env, ...IDENTITY },
      maxBuffer: 64 * 1024 ** 2,
    })
  ).stdout.trim();

export interface StackHead {
  id: string;
  sha: string;
}

export interface StackConflict {
  files: string[];
  id: string;
}

export const mergeStack = async ({
  base,
  heads,
  repo,
}: {
  base: string;
  heads: StackHead[];
  repo: string;
}) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'style-eq-stack-merge-'));
  const worktree = path.join(scratch, 'merge');
  const baseSha = await git(repo, ['rev-parse', '--verify', `${base}^{commit}`]);
  await git(repo, ['worktree', 'add', '--detach', '--quiet', worktree, baseSha]);
  const merged: string[] = [];
  const conflicts: StackConflict[] = [];
  const resolved: StackConflict[] = [];
  const stage = (index: 2 | 3, file: string) =>
    git(worktree, ['show', `:${index}:${file}`]).catch(() => '');
  const comparable = async (file: string) =>
    /\.(tsx|css)$/.test(file) ||
    (file.endsWith('.ts') &&
      (await Promise.all([stage(2, file), stage(3, file)])).some((text) =>
        STYLE_FACTORY.test(text),
      ));
  try {
    for (const head of heads) {
      try {
        await git(worktree, ['merge', '--no-ff', '--no-edit', '--quiet', head.sha]);
        merged.push(head.id);
        continue;
      } catch {
        const files = (await git(worktree, ['diff', '--name-only', '--diff-filter=U']))
          .split('\n')
          .filter(Boolean);
        const blocking = [];
        for (const file of files) if (await comparable(file)) blocking.push(file);
        if (blocking.length || !files.length) {
          await git(worktree, ['merge', '--abort']).catch(() => undefined);
          conflicts.push({ files: blocking.length ? blocking : files, id: head.id });
          continue;
        }
        await git(worktree, ['checkout', '--ours', '--', ...files]);
        await git(worktree, ['add', '--', ...files]);
        await git(worktree, ['commit', '--no-edit', '--quiet']);
        merged.push(head.id);
        resolved.push({ files, id: head.id });
      }
    }
    return {
      base: baseSha,
      conflicts,
      head: await git(worktree, ['rev-parse', 'HEAD']),
      merged,
      resolved,
    };
  } finally {
    await git(repo, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
    await git(repo, ['worktree', 'prune']);
    await rm(scratch, { force: true, recursive: true });
  }
};

export interface Shard {
  files: string[];
  id: string;
}

export const planShards = (prs: Shard[]): Shard[] => {
  const taken = new Set<string>();
  return prs
    .map(({ files, id }) => ({
      files: files.filter((file) => !taken.has(file) && (taken.add(file), true)),
      id,
    }))
    .filter((shard) => shard.files.length);
};

export interface StackOptions {
  base: string;
  browser?: Browser;
  concurrency?: number;
  configFile: string;
  heads: StackHead[];
  mutations?: number;
  recordsDir: string;
  repo: string;
}

export interface StackResult {
  base: string;
  conflicts: StackConflict[];
  head: string;
  mergeable: boolean;
  merged: string[];
  resolved: StackConflict[];
  shards: Array<Shard & { result: RunResult }>;
}

export const runStack = async (options: StackOptions): Promise<StackResult> => {
  const stack = await mergeStack(options);
  const prs = await Promise.all(
    options.heads
      .filter((head) => stack.merged.includes(head.id))
      .map(async (head) => ({
        files: (await git(options.repo, ['diff', '--name-only', `${stack.base}...${head.sha}`]))
          .split('\n')
          .filter(Boolean),
        id: head.id,
      })),
  );
  const shards = planShards(prs);
  const perShard = Math.max(
    1,
    Math.ceil((options.mutations ?? DEFAULT_MUTATIONS) / Math.max(shards.length, 1)),
  );
  const results: StackResult['shards'] = [];
  const queue = [...shards];
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 2, shards.length) }, async () => {
      for (let shard = queue.shift(); shard; shard = queue.shift()) {
        const result = await runComparison({
          base: stack.base,
          browser: options.browser,
          configFile: options.configFile,
          head: stack.head,
          mutations: options.mutations === 0 ? 0 : perShard,
          recordsDir: options.recordsDir,
          repo: options.repo,
          restrictTo: shard.files,
        });
        results.push({ ...shard, result });
      }
    }),
  );
  const ordered = shards.map((shard) => results.find((entry) => entry.id === shard.id)!);
  return {
    ...stack,
    mergeable: !stack.conflicts.length && ordered.every((entry) => entry.result.verdict.mergeable),
    shards: ordered,
  };
};
