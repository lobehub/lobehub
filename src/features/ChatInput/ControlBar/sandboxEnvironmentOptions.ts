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
 * The environment the server applies to a project conversation nobody placed:
 * the project's, when it checks out a repository (see
 * `resolveProjectTopicSandbox`). Undefined while it loads, or when there is none.
 */
export const projectStartEnvironmentId = (
  environments: readonly {
    configuration?: Pick<EnvironmentConfiguration, 'sources'> | null;
    id: string;
  }[],
) =>
  environments.find((environment) =>
    (environment.configuration?.sources ?? []).some((source) => source.kind === 'git'),
  )?.id;

/**
 * Whether a selection works in a folder of a workspace's public drive, which
 * every member can browse. In a workspace a folder with no drive named is on
 * the public one.
 */
export const isOnPublicDrive = (selection: SandboxSelection, workspaceId?: string | null) =>
  !!workspaceId &&
  !selection.instanceId &&
  selection.workingDirectory !== undefined &&
  selection.drive !== 'personal';

/**
 * The selection once a folder of the drive is picked: a project's environment
 * stays, and is set up there if the folder is empty. A legacy environment
 * directory is replaced.
 */
export const selectionWithFolder = (
  selection: SandboxSelection,
  folder: Pick<SandboxSelection, 'drive' | 'workingDirectory'>,
): SandboxSelection => ({
  ...(folder.drive && { drive: folder.drive }),
  ...(selection.environmentId && { environmentId: selection.environmentId }),
  workingDirectory: folder.workingDirectory,
});
