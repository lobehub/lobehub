import type { SandboxSelection } from './useSandboxPlacement';

/** Prefix of every entry; each user + workspace + agent has a key of its own. */
export const REMEMBERED_SANDBOX_DIRECTORY_PREFIX = 'lobechat-sandbox-last-directory';

/**
 * Prefix of the environment's memory, kept apart from the folder: which
 * environment the agent's last conversation was set up from — or that it used
 * none — whether it kept its files on the drive or not.
 */
export const REMEMBERED_SANDBOX_REPOSITORY_PREFIX = 'lobechat-sandbox-last-repository';

/** The folder part of a selection: which drive, and where on it. */
export type RememberedSandboxDirectory = Pick<SandboxSelection, 'drive' | 'workingDirectory'>;

/** Whose memory this is: the signed-in user, in the active workspace (if any). */
export interface RememberScope {
  userId?: string | null;
  workspaceId?: string | null;
}

// Scoped to the signed-in user first: storage outlives a logout, and a shared
// agent has the same workspace and agent ids for every member, while a
// personal-drive folder is one member's own — the next person on the same
// browser must not inherit it. The drive is per account, so a folder picked in
// one workspace means nothing in another; the agent is part of the key because
// each agent's conversations tend to live in their own folder. Without a known
// user nothing is read or written.
const scopedKey = (prefix: string, { userId, workspaceId }: RememberScope, agentId: string) =>
  userId ? `${prefix}:${userId}:${workspaceId || 'personal'}:${agentId}` : undefined;

export const rememberedSandboxDirectoryKey = (scope: RememberScope, agentId: string) =>
  scopedKey(REMEMBERED_SANDBOX_DIRECTORY_PREFIX, scope, agentId);

export const rememberedSandboxRepositoryKey = (scope: RememberScope, agentId: string) =>
  scopedKey(REMEMBERED_SANDBOX_REPOSITORY_PREFIX, scope, agentId);

const readEntry = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

const isValid = (value: unknown): value is RememberedSandboxDirectory => {
  if (!value || typeof value !== 'object') return false;
  const { drive, workingDirectory } = value as RememberedSandboxDirectory;
  if (typeof workingDirectory !== 'string' || !workingDirectory) return false;
  return drive === undefined || drive === 'personal' || drive === 'public';
};

/** The folder this agent's last conversation was pointed at, if any. */
export const getRememberedSandboxDirectory = (
  scope: RememberScope,
  agentId: string,
): RememberedSandboxDirectory | undefined => {
  const key = rememberedSandboxDirectoryKey(scope, agentId);
  if (!key) return undefined;

  const value = readEntry(key);
  if (!isValid(value)) return undefined;

  return value.drive
    ? { drive: value.drive, workingDirectory: value.workingDirectory }
    : { workingDirectory: value.workingDirectory };
};

/**
 * The environment picked together with the remembered folder, if any. Kept in
 * the folder's own entry rather than read from the environment memory: the two
 * memories are written apart, and a folder paired with an environment it was
 * never set up from would skip the setup — it only runs in an empty folder.
 */
export const getRememberedSandboxDirectoryEnvironment = (
  scope: RememberScope,
  agentId: string,
): string | undefined => {
  const key = rememberedSandboxDirectoryKey(scope, agentId);
  if (!key) return undefined;

  const value = readEntry(key);
  if (!isValid(value)) return undefined;
  const { environmentId } = value as { environmentId?: unknown };
  return typeof environmentId === 'string' && environmentId ? environmentId : undefined;
};

/**
 * What the agent's last conversation was set up from: `{ environmentId }`
 * for a repository, `{}` for none picked on purpose, `undefined` when nothing
 * is remembered yet.
 */
export const getRememberedSandboxRepository = (
  scope: RememberScope,
  agentId: string,
): Pick<SandboxSelection, 'environmentId'> | undefined => {
  const key = rememberedSandboxRepositoryKey(scope, agentId);
  if (!key) return undefined;

  const value = readEntry(key) as { environmentId?: unknown } | undefined;
  if (!value || typeof value !== 'object') return undefined;
  if (value.environmentId === undefined) return {};
  return typeof value.environmentId === 'string' && value.environmentId
    ? { environmentId: value.environmentId }
    : undefined;
};

/**
 * Remember a pick so the next conversation starts where this one was put. The
 * folder and the environment are two answers, each remembered on its own:
 *
 * - a folder on the drive is remembered as the folder, with the environment
 *   picked together with it; switching the drive off leaves the folder memory
 *   alone, for the next time it is switched on;
 * - the environment — or none, picked on purpose — is remembered whether or
 *   not the drive is on. `folderOnly` skips it, for an environment that only
 *   means something where it was picked: a project's;
 * - a legacy environment directory says nothing about either and changes
 *   nothing.
 *
 * Storage unavailable (private mode, quota) is ignored: the next conversation
 * starts at the plan's default, as it did before anything was remembered.
 */
export const rememberSandboxSelection = (
  scope: RememberScope,
  agentId: string,
  selection: SandboxSelection,
  { folderOnly = false }: { folderOnly?: boolean } = {},
): void => {
  const key = rememberedSandboxDirectoryKey(scope, agentId);
  if (!key) return;

  const repositoryKey = rememberedSandboxRepositoryKey(scope, agentId)!;
  if (selection.instanceId) return;

  try {
    if (selection.workingDirectory) {
      localStorage.setItem(
        key,
        JSON.stringify({
          ...(selection.drive && { drive: selection.drive }),
          ...(!folderOnly && selection.environmentId && { environmentId: selection.environmentId }),
          workingDirectory: selection.workingDirectory,
        }),
      );
    }
    if (folderOnly) return;

    localStorage.setItem(
      repositoryKey,
      JSON.stringify(selection.environmentId ? { environmentId: selection.environmentId } : {}),
    );
  } catch {
    // Storage unavailable: nothing is remembered, as described above.
  }
};
