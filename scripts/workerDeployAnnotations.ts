import { execSync } from 'node:child_process';

export interface LocalOperator {
  email: string;
  sha: string;
}

// Cloudflare stamps every version with the API token's owner, never with the person or
// pipeline behind it, so the operator has to travel in the version's own annotations.
export const workerDeployAnnotationArgs = (
  env: NodeJS.ProcessEnv,
  local: LocalOperator | undefined,
): string[] => {
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_SHA) {
    const sha = env.GITHUB_SHA.slice(0, 7);
    return [
      '--tag',
      sha,
      '--message',
      `${env.GITHUB_ACTOR ?? 'actions'} ${env.GITHUB_REPOSITORY ?? ''}@${sha} run ${env.GITHUB_RUN_ID ?? ''}`,
    ];
  }
  if (!local) return [];
  const sha = local.sha.slice(0, 7);
  return ['--tag', sha, '--message', `${local.email} local@${sha}`];
};

const git = (cwd: string, args: string): string | undefined => {
  try {
    return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
};

export const localOperator = (cwd: string): LocalOperator | undefined => {
  const email = git(cwd, 'config user.email');
  const sha = git(cwd, 'rev-parse HEAD');
  return email && sha ? { email, sha } : undefined;
};
