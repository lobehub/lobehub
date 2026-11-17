import type { SandboxSelection } from './useSandboxPlacement';

/** Prefix of every entry; each user + workspace + agent has a key of its own. */
export const REMEMBERED_SANDBOX_DIRECTORY_PREFIX = 'lobechat-sandbox-last-directory';

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
export const rememberedSandboxDirectoryKey = (
  { userId, workspaceId }: RememberScope,
  agentId: string,
) =>
  userId
    ? `${REMEMBERED_SANDBOX_DIRECTORY_PREFIX}:${userId}:${workspaceId || 'personal'}:${agentId}`
    : undefined;

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

  let value: unknown;
  try {
    const raw = localStorage.getItem(key);
    value = raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
  if (!isValid(value)) return undefined;

  return value.drive
    ? { drive: value.drive, workingDirectory: value.workingDirectory }
    : { workingDirectory: value.workingDirectory };
};

/**
 * Remember a pick so the next conversation starts where this one was put:
 *
 * - a folder on the drive is remembered;
 * - the temporary sandbox, picked on purpose, forgets it — the next
 *   conversation goes back to the plan's default;
 * - a repository switch that leaves the folder unset, or a legacy environment
 *   directory, says nothing about folders and leaves the memory as it was.
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

  try {
    if (!selection.instanceId && selection.workingDirectory) {
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

    const temporary =
      !selection.instanceId && !selection.environmentId && selection.workingDirectory === undefined;
    if (temporary) localStorage.removeItem(key);
  } catch {
    // see above
  }
};
