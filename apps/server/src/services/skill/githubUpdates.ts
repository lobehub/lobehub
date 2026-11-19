import { createHash } from 'node:crypto';

import type { GitHubSkillCheck, SkillItem } from '@lobechat/types';
import pMap from 'p-map';

import { type GitHub, GitHubRateLimitError, type GitHubRepoInfo } from '@/server/modules/GitHub';

import { readGitHubArchive } from './githubArchive';
import type { SkillParser } from './parser';

export const isCommit = (ref: string) => /^[a-f0-9]{40}$/i.test(ref);

export const revisionOf = (skill: Pick<SkillItem, 'id' | 'updatedAt'>) =>
  skill.id + '/' + skill.updatedAt.toISOString();

export function installedFingerprint(
  skill: Pick<SkillItem, 'content' | 'manifest' | 'name' | 'description' | 'resources'>,
) {
  // Postgres JSONB does not preserve object key order.
  const serialized = JSON.stringify(
    [skill.content, skill.name, skill.description, skill.manifest, skill.resources],
    (_, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )
        : value,
  );
  return createHash('sha256').update(serialized).digest('hex');
}

type TrackedRow = { info: GitHubRepoInfo; skill: SkillItem };

/** A ref is resolved once per check. Cache only immutable package hashes, never ZIP buffers. */
const packageHashes = new Map<string, string | null>();

async function readPackageHashes(
  github: GitHub,
  parser: SkillParser,
  info: GitHubRepoInfo,
  commit: string,
  paths: Set<string>,
) {
  const hashes = new Map<string, string | null>();
  const pending = [];
  const key = (path: string) =>
    JSON.stringify([info.owner.toLowerCase(), info.repo.toLowerCase(), commit, path]);
  for (const path of paths) {
    const cached = packageHashes.get(key(path));
    if (cached === undefined) pending.push(path);
    else hashes.set(path, cached);
  }
  if (!pending.length) return hashes;

  const archive = await readGitHubArchive(await github.downloadCommitZip(info, commit), pending);
  for (const path of pending) {
    const directory = archive.get(path);
    try {
      const hash = directory
        ? (await parser.parseGitHubDirectory(directory, path.split('/').at(-1) || info.repo))
            .zipHash
        : null;
      if (hash === undefined) continue;
      hashes.set(path, hash);
      if (packageHashes.size >= 2048) {
        const oldest = packageHashes.keys().next();
        if (!oldest.done) packageHashes.delete(oldest.value);
      }
      packageHashes.set(key(path), hash);
    } catch {
      // This directory is malformed. Other installed skills can still be checked.
    }
  }
  return hashes;
}

export async function checkGitHubRows(rows: TrackedRow[], github: GitHub, parser: SkillParser) {
  const results: Record<string, GitHubSkillCheck> = {};
  const groups = new Map<string, TrackedRow[]>();
  for (const row of rows) {
    const { skill, info } = row;
    if (isCommit(info.branch)) {
      results[skill.id] = skill.upstream
        ? { status: 'pinned' }
        : { revision: revisionOf(skill), status: 'chooseRef' };
      continue;
    }
    const key = JSON.stringify([info.owner.toLowerCase(), info.repo.toLowerCase(), info.branch]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  let limited = false;
  await pMap(
    groups.values(),
    async (group) => {
      try {
        if (limited) {
          for (const { skill } of group) results[skill.id] = { status: 'limited' };
          return;
        }
        const { info } = group[0];
        const commit = await github.resolveCommit(info);
        const changed = group.filter(({ skill }) => {
          if (skill.upstream?.installedCommit !== commit) return true;
          results[skill.id] = { status: 'current' };
          return false;
        });
        const paths = new Set(changed.map(({ info }) => info.path ?? ''));
        const hashes = await readPackageHashes(github, parser, info, commit, paths);
        for (const { info: source, skill } of changed) {
          const hash = hashes.get(source.path ?? '');
          if (hash === undefined) results[skill.id] = { status: 'unavailable' };
          else if (hash === null) results[skill.id] = { status: 'missing' };
          else if (hash === skill.zipFileHash) results[skill.id] = { status: 'current' };
          else
            results[skill.id] = {
              commit,
              localChanges: skill.upstream?.installedFingerprint !== installedFingerprint(skill),
              revision: revisionOf(skill),
              status: 'update',
            };
        }
      } catch (error) {
        const status = error instanceof GitHubRateLimitError ? 'limited' : 'unavailable';
        if (status === 'limited') limited = true;
        for (const { skill } of group) results[skill.id] ??= { status };
      }
    },
    { concurrency: 3 },
  );
  return results;
}
