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
const scopedKey = (prefix: string, { userId, workspaceId }: RememberScope, agentId: string) =>
  userId ? `${prefix}:${userId}:${workspaceId || 'personal'}:${agentId}` : undefined;

export const rememberedSandboxDirectoryKey = (scope: RememberScope, agentId: string) =>
  scopedKey(REMEMBERED_SANDBOX_DIRECTORY_PREFIX, scope, agentId);

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
 * Remember a pick so the next conversation starts where this one was put: a
 * folder on the drive is remembered as the folder, and switching the drive off
 * leaves that memory alone, for the next time it is switched on. A legacy
 * environment directory changes nothing. The cloud sandbox is not set up from
 * an environment, so none is remembered.
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
  if (!key || selection.instanceId || !selection.workingDirectory) return;

  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...(selection.drive && { drive: selection.drive }),
        workingDirectory: selection.workingDirectory,
      }),
    );
  } catch {
    // Storage unavailable: nothing is remembered, as described above.
  }
};
