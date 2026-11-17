import type { SandboxSelection } from './useSandboxPlacement';

/** Prefix of every entry; each user + workspace + agent has a key of its own. */
export const REMEMBERED_SANDBOX_DIRECTORY_PREFIX = 'lobechat-sandbox-last-directory';

/**
 * Prefix of the temporary sandbox's memory, kept apart from the folder: the
 * persistent sandbox remembers which folder of the drive, the temporary one
 * which repository it was initialized from — or that it used none.
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
 * What the agent's last temporary sandbox was initialized from: `{ environmentId }`
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
 * Remember a pick so the next conversation starts where this one was put:
 *
 * - a folder on the drive — the persistent sandbox — is remembered as its
 *   folder;
 * - the temporary sandbox is remembered as the repository it starts from, or
 *   as none; the folder memory stays, for the next time the persistent
 *   sandbox is used;
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
): void => {
  const key = rememberedSandboxDirectoryKey(scope, agentId);
  if (!key) return;

  const repositoryKey = rememberedSandboxRepositoryKey(scope, agentId)!;
  if (selection.instanceId) return;

  try {
    if (selection.workingDirectory) {
      localStorage.setItem(
        key,
        JSON.stringify(
          selection.drive
            ? { drive: selection.drive, workingDirectory: selection.workingDirectory }
            : { workingDirectory: selection.workingDirectory },
        ),
      );
      return;
    }

    localStorage.setItem(
      repositoryKey,
      JSON.stringify(selection.environmentId ? { environmentId: selection.environmentId } : {}),
    );
  } catch {
    // Storage unavailable: nothing is remembered, as described above.
  }
};
