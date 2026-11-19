import type { EnvironmentConfiguration } from '@lobechat/types';

import type { SandboxSelection } from './useSandboxPlacement';

/**
 * The environments a conversation may start from. A workspace-public agent runs
 * on its caller's session, so it applies published environments only — the
 * server refuses a private one for it, and offering it here would promise a
 * setup that never runs.
 */
export const pickableEnvironments = <T extends { visibility?: string | null }>(
  environments: readonly T[],
  sharedAgent: boolean,
): T[] =>
  sharedAgent
    ? environments.filter((environment) => environment.visibility === 'public')
    : [...environments];

/** The `owner/name` of the repository an environment checks out, when it has one. */
export const repositorySlug = (environment: {
  configuration?: Pick<EnvironmentConfiguration, 'sources'> | null;
}): string | undefined => {
  const source = environment.configuration?.sources?.[0];
  if (source?.kind !== 'git') return undefined;
  const { url } = source;
  try {
    return new URL(url).pathname.replaceAll(/^\/+|\/+$/g, '').replace(/\.git$/, '') || undefined;
  } catch {
    return undefined;
  }
};

/**
 * The repositories an environment checks out, as a label: the first one's
 * `owner/name`, and `+N` for the rest — so a picker row never reads as one
 * repository when the environment clones several.
 */
export const repositoriesLabel = (environment: {
  configuration?: Pick<EnvironmentConfiguration, 'sources'> | null;
}): string | undefined => {
  const first = repositorySlug(environment);
  if (!first) return undefined;
  const count = (environment.configuration?.sources ?? []).filter(
    (source) => source.kind === 'git',
  ).length;
  return count > 1 ? `${first} +${count - 1}` : first;
};

/**
 * What the environment chip says. A list still loading, or one that failed to
 * load, says nothing about the topic's environment — so it is not reported as
 * "none", which would read as initialization being off.
 */
export type EnvironmentChipState =
  | { kind: 'loading' }
  | { kind: 'loadFailed' }
  | { kind: 'missing' }
  | { kind: 'none' }
  | { kind: 'picked'; name: string };

export const environmentChipState = ({
  current,
  environmentId,
  failed,
  loaded,
}: {
  current?: { name: string };
  environmentId?: string;
  failed: boolean;
  loaded: boolean;
}): EnvironmentChipState => {
  if (!environmentId) return { kind: 'none' };
  if (current) return { kind: 'picked', name: current.name };
  if (loaded) return { kind: 'missing' };

  return failed ? { kind: 'loadFailed' } : { kind: 'loading' };
};

/**
 * Where a conversation works once a repository is picked: a fresh temporary
 * sandbox the repository is cloned into. A repository is only cloned into an
 * empty folder, so it never inherits the folder the conversation was on, and
 * it is never checked out on the drive — the persistent sandbox is for keeping
 * a folder of the drive, not a repository.
 */
export const repositorySelection = (environment: { id: string }): SandboxSelection => ({
  environmentId: environment.id,
});
