import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import type { EnvironmentConfiguration } from '@lobechat/types';

import { getProjectSettingsPath } from '@/features/Projects/Layout/navigation';

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
 * Where a conversation's environments are managed: a project's one on the
 * project's settings, anything else in the workspace's list.
 */
export const environmentSettingsPath = (projectId?: string) =>
  projectId ? getProjectSettingsPath(projectId, 'environments') : '/settings/environments';

/**
 * The folder an environment is set up in when the conversation keeps its files
 * on the drive: one of its own, named after the repository it checks out (or
 * the environment itself) plus a short piece of its id, at the top of the
 * drive. The id keeps two environments of the same repository — different
 * refs, setup or variables — and a folder of the person's own apart: the
 * setup only runs in an empty folder, so a shared one would keep the first
 * environment's checkout under the second's name. The server creates it on
 * the first run, and the next conversation that picks the environment finds
 * the checkout already there.
 */
export const environmentFolderName = (environment: {
  configuration?: Pick<EnvironmentConfiguration, 'sources'> | null;
  id: string;
  name: string;
}): string => {
  const base = repositorySlug(environment)?.split('/').pop() || environment.name;
  const suffix = environment.id.replaceAll(/[^\dA-Za-z]/g, '').slice(-6);
  // A single path segment the drive accepts: no separators, no leading dot
  // (hidden, and `.`/`..` are not folders) or `~`, no surrounding whitespace.
  // Checked with the server's own rule at the end: a name it refuses would
  // send every run to a temporary sandbox while the chip names the folder.
  const name = base
    .replaceAll(/[/\\]+/g, '-')
    .trim()
    .replace(/^[.~]+/, '')
    .slice(0, 56)
    .trim();
  const folder = [name || 'environment', suffix].filter(Boolean).join('-');
  return isSafeSandboxCwd(folder) ? folder : 'environment';
};

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
 * The selection once the drive is switched on or off. Off is the temporary
 * sandbox, still set up from the environment it had. On keeps the
 * environment too: in the environment's own folder when there is one, so it
 * is set up in an empty folder, and otherwise in `defaultFolder` — the folder
 * the agent's last conversation used, or the plan's default.
 */
export const selectionWithDrive = (
  selection: SandboxSelection,
  enabled: boolean,
  {
    defaultFolder,
    environment,
  }: {
    defaultFolder: Pick<SandboxSelection, 'drive' | 'workingDirectory'>;
    environment?: Parameters<typeof environmentFolderName>[0];
  },
): SandboxSelection => {
  const { environmentId } = selection;
  if (!enabled) return environmentId ? { environmentId } : {};

  const folder =
    environmentId && environment
      ? { drive: defaultFolder.drive, workingDirectory: environmentFolderName(environment) }
      : defaultFolder;
  return environmentId ? { ...folder, environmentId } : { ...folder };
};

/**
 * The selection once an environment (or none) is picked. On the drive, an
 * environment moves the conversation into that environment's own folder, so
 * it is set up rather than skipped in a folder that already holds files;
 * none keeps the folder. Off the drive only the environment changes. A
 * legacy environment directory is replaced either way.
 */
export const selectionWithEnvironment = (
  selection: SandboxSelection,
  environment?: Parameters<typeof environmentFolderName>[0] & { id: string },
): SandboxSelection => {
  const onDrive = !!selection.instanceId || selection.workingDirectory !== undefined;
  if (!onDrive) return environment ? { environmentId: environment.id } : {};

  if (!environment) {
    if (selection.instanceId) return {};
    return selection.drive
      ? { drive: selection.drive, workingDirectory: selection.workingDirectory }
      : { workingDirectory: selection.workingDirectory };
  }

  return {
    ...(selection.drive && { drive: selection.drive }),
    environmentId: environment.id,
    workingDirectory: environmentFolderName(environment),
  };
};

/**
 * The selection once a folder of the drive is picked: the environment stays,
 * and is set up there if the folder is empty.
 */
export const selectionWithFolder = (
  selection: SandboxSelection,
  folder: Pick<SandboxSelection, 'drive' | 'workingDirectory'>,
): SandboxSelection => ({
  ...(folder.drive && { drive: folder.drive }),
  ...(selection.environmentId && { environmentId: selection.environmentId }),
  workingDirectory: folder.workingDirectory,
});
