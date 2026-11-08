import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import { git } from './git';

const execute = promisify(execFile);
const repositoryName = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
const sha = z.string().regex(/^[\da-f]{40}$/);
const prSchema = z.object({
  base: z.object({ ref: z.string().min(1), repo: z.object({ full_name: repositoryName }), sha }),
  head: z.object({ repo: z.object({ full_name: repositoryName }).nullable(), sha }),
  number: z.number().int().positive(),
});

export const resolveRepositoryName = async (directory: string, explicit?: string) => {
  if (explicit) return repositoryName.parse(explicit);
  const url = (await git(directory, ['remote', 'get-url', 'origin'])).toString().trim();
  const match = url.match(
    /^(?:git@github\.com:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
  );
  if (!match) throw new Error('GITHUB_REPOSITORY_REQUIRED: pass --repo owner/name');
  return repositoryName.parse(match[1]);
};

export const validatePullRequest = (value: unknown, repository: string, number: number) => {
  const pr = prSchema.parse(value);
  if (pr.number !== number || pr.base.repo.full_name.toLowerCase() !== repository.toLowerCase())
    throw new Error('PR_REPOSITORY_IDENTITY_MISMATCH');
  if (!pr.head.repo) throw new Error('PR_HEAD_REPOSITORY_UNAVAILABLE');
  return {
    base: pr.base.sha,
    baseRef: pr.base.ref,
    head: pr.head.sha,
    headRepository: pr.head.repo.full_name,
    number,
    repository,
  };
};

/** Read-only API. Objects must exist locally; never fetch into the user's Git database. */
export const resolvePullRequest = async (
  directory: string,
  number: number,
  explicitRepository?: string,
) => {
  const repository = await resolveRepositoryName(directory, explicitRepository);
  const { stdout } = await execute(
    'gh',
    ['api', '--hostname', 'github.com', `repos/${repository}/pulls/${number}`],
    {
      cwd: directory,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  return validatePullRequest(JSON.parse(stdout), repository, number);
};
