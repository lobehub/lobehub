/**
 * Git mutations on a remote device; failures come back as `{ error, success: false }`.
 */
import type {
  DeviceGitAddWorktreeResult,
  DeviceGitCheckoutResult,
  DeviceGitDeleteBranchResult,
  DeviceGitFileRevertResult,
  DeviceGitPullRequestAction,
  DeviceGitPullRequestActionResult,
  DeviceGitRemoveWorktreeResult,
  DeviceGitRenameBranchResult,
  DeviceGitSyncResult,
  OwnedWorktreeCleanupResult,
  OwnedWorktreeRestoreResult,
} from '@lobechat/types';
import { OWNED_WORKTREE_RPC_UNSUPPORTED } from '@lobechat/types';
import debug from 'debug';

import { gitPullRequestDetail } from './gitRead';
import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/**
 * Checkout (or create) a branch in a directory on a remote device via the
 * `checkoutGitBranch` device RPC.
 */
export async function checkoutGitBranch(
  getClient: DeviceClientGetter,
  params: {
    branch: string;
    create?: boolean;
    deviceId: string;
    path: string;
    /** Cut the new branch from this branch instead of HEAD (needs `create`). */
    startPoint?: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitCheckoutResult> {
  const {
    userId,
    deviceId,
    branch,
    create,
    path,
    startPoint,
    timeout = 30_000,
    workspaceId,
  } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitCheckoutResult>(
      { deviceId, timeout, userId, workspaceId },
      {
        method: 'checkoutGitBranch',
        params: { branch, create, path, ...(startPoint ? { startPoint } : {}) },
      },
    );

    if (!result.success || !result.data) {
      log('checkoutGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Checkout failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('checkoutGitBranch: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Checkout failed', success: false };
  }
}

/**
 * Rename a branch in a directory on a remote device via the `renameGitBranch`
 * device RPC.
 */
export async function renameGitBranch(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    from: string;
    path: string;
    timeout?: number;
    to: string;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitRenameBranchResult> {
  const { userId, deviceId, from, to, path, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitRenameBranchResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'renameGitBranch', params: { from, path, to } },
    );

    if (!result.success || !result.data) {
      log('renameGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Rename failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('renameGitBranch: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Rename failed', success: false };
  }
}

/**
 * Delete a branch in a directory on a remote device via the `deleteGitBranch`
 * device RPC.
 */
export async function deleteGitBranch(
  getClient: DeviceClientGetter,
  params: {
    branch: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitDeleteBranchResult> {
  const { userId, deviceId, branch, path, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitDeleteBranchResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'deleteGitBranch', params: { branch, path } },
    );

    if (!result.success || !result.data) {
      log('deleteGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Delete failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('deleteGitBranch: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Delete failed', success: false };
  }
}

/**
 * Remove a worktree in a directory's repository on a remote device via
 * the `removeGitWorktree` device RPC.
 */
export async function removeGitWorktree(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
    worktreePath: string;
  },
): Promise<DeviceGitRemoveWorktreeResult> {
  const { userId, deviceId, path, worktreePath, workspaceId, timeout = 30_000 } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitRemoveWorktreeResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'removeGitWorktree', params: { path, worktreePath } },
    );

    if (!result.success || !result.data) {
      log('removeGitWorktree: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Remove worktree failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('removeGitWorktree: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Remove worktree failed', success: false };
  }
}

/**
 * Add a linked worktree on a fresh branch in a directory's repository on a
 * remote device via the `addGitWorktree` device RPC.
 */
export async function addGitWorktree(
  getClient: DeviceClientGetter,
  params: {
    branch: string;
    deviceId: string;
    /** Creation receipt the device writes into the worktree (app-created worktrees). */
    ownerToken?: string;
    path: string;
    /** Fork the worktree's branch from this branch instead of HEAD. */
    startPoint?: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
    worktreePath: string;
  },
): Promise<DeviceGitAddWorktreeResult> {
  const {
    userId,
    deviceId,
    branch,
    ownerToken,
    path,
    startPoint,
    worktreePath,
    workspaceId,
    timeout = 30_000,
  } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitAddWorktreeResult>(
      { deviceId, timeout, userId, workspaceId },
      {
        method: 'addGitWorktree',
        params: {
          branch,
          path,
          worktreePath,
          ...(ownerToken ? { ownerToken } : {}),
          ...(startPoint ? { startPoint } : {}),
        },
      },
    );

    if (!result.success || !result.data) {
      log('addGitWorktree: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Add worktree failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('addGitWorktree: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Add worktree failed', success: false };
  }
}

/** A device client older than the owned-worktree RPCs rejects the method name. */
const isUnsupportedMethod = (error: string | undefined) =>
  !!error && error.includes(OWNED_WORKTREE_RPC_UNSUPPORTED);

/**
 * Remove (or keep, when it has uncommitted work) a worktree the app created
 * for a conversation, via the `cleanupOwnedWorktree` device RPC. Every guard
 * runs on the device. A device that cannot be reached or is too old for the
 * RPC answers `unreachable`, which the caller keeps as pending.
 */
export async function cleanupOwnedWorktree(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    discard?: boolean;
    /** The creation receipt the device checks before acting (see local-file-shell). */
    ownerToken?: string;
    sourcePath: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
    worktreePath: string;
  },
): Promise<OwnedWorktreeCleanupResult> {
  const {
    userId,
    deviceId,
    discard,
    ownerToken,
    sourcePath,
    worktreePath,
    workspaceId,
    // Above the device's own 90s budget, so its answer (not ours) decides.
    timeout = 100_000,
  } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', outcome: 'unreachable' };

  try {
    const result = await client.invokeRpc<OwnedWorktreeCleanupResult>(
      { deviceId, timeout, userId, workspaceId },
      {
        method: 'cleanupOwnedWorktree',
        params: {
          discard: discard === true,
          ...(ownerToken && { ownerToken }),
          sourcePath,
          worktreePath,
        },
      },
    );
    if (!result.success || !result.data) {
      log('cleanupOwnedWorktree: failed for deviceId=%s — %s', deviceId, result.error);
      return {
        error: result.error || 'Device unreachable',
        outcome: 'unreachable',
        ...(isUnsupportedMethod(result.error) && { outdated: true }),
      };
    }
    return result.data;
  } catch (error) {
    const message = (error as Error)?.message || 'Device unreachable';
    log('cleanupOwnedWorktree: error for deviceId=%s — %O', deviceId, error);
    return {
      error: message,
      outcome: 'unreachable',
      ...(isUnsupportedMethod(message) && { outdated: true }),
    };
  }
}

/**
 * Check a cleaned-up worktree out again at its path via the
 * `restoreOwnedWorktree` device RPC.
 */
export async function restoreOwnedWorktree(
  getClient: DeviceClientGetter,
  params: {
    branch: string;
    deviceId: string;
    ownerToken?: string;
    sourcePath: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
    worktreePath: string;
  },
): Promise<OwnedWorktreeRestoreResult> {
  const {
    userId,
    deviceId,
    branch,
    ownerToken,
    sourcePath,
    worktreePath,
    workspaceId,
    timeout = 45_000,
  } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', outcome: 'unreachable' };

  try {
    const result = await client.invokeRpc<OwnedWorktreeRestoreResult>(
      { deviceId, timeout, userId, workspaceId },
      {
        method: 'restoreOwnedWorktree',
        params: { branch, ...(ownerToken && { ownerToken }), sourcePath, worktreePath },
      },
    );
    if (!result.success || !result.data) {
      log('restoreOwnedWorktree: failed for deviceId=%s — %s', deviceId, result.error);
      return {
        error: result.error || 'Device unreachable',
        outcome: 'unreachable',
        ...(isUnsupportedMethod(result.error) && { outdated: true }),
      };
    }
    return result.data;
  } catch (error) {
    const message = (error as Error)?.message || 'Device unreachable';
    log('restoreOwnedWorktree: error for deviceId=%s — %O', deviceId, error);
    return {
      error: message,
      outcome: 'unreachable',
      ...(isUnsupportedMethod(message) && { outdated: true }),
    };
  }
}

/**
 * Pull (`--ff-only`) the current branch of a directory on a remote device via
 * the `pullGitBranch` device RPC.
 */
export async function pullGitBranch(
  getClient: DeviceClientGetter,
  params: {
    /** Sync this branch instead of HEAD. */
    branch?: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitSyncResult> {
  const { userId, deviceId, branch, path, timeout = 65_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitSyncResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'pullGitBranch', params: { path, ...(branch ? { branch } : {}) } },
    );

    if (!result.success || !result.data) {
      log('pullGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Pull failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('pullGitBranch: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Pull failed', success: false };
  }
}

/**
 * Push the current branch of a directory on a remote device via the
 * `pushGitBranch` device RPC.
 */
export async function pushGitBranch(
  getClient: DeviceClientGetter,
  params: {
    /** Sync this branch instead of HEAD. */
    branch?: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitSyncResult> {
  const { userId, deviceId, branch, path, timeout = 65_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitSyncResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'pushGitBranch', params: { path, ...(branch ? { branch } : {}) } },
    );

    if (!result.success || !result.data) {
      log('pushGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Push failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('pushGitBranch: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Push failed', success: false };
  }
}

/**
 * Run a `gh pr` mutation (merge, auto-merge, ready, comment, close, ...) on a
 * directory on a remote device via the `runPullRequestAction` device RPC.
 * Merge can take a while, so it gets the same 65s budget as push/pull.
 */
export async function runGitPullRequestAction(
  getClient: DeviceClientGetter,
  params: {
    action: DeviceGitPullRequestAction;
    deviceId: string;
    number: number;
    path: string;
    timeout?: number;
    url?: string;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitPullRequestActionResult> {
  const { userId, deviceId, path, number, action, url, workspaceId } = params;
  const timeout = params.timeout ?? (url ? 75_000 : 65_000);
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const scope = { deviceId, timeout, userId, workspaceId };
    const legacy = { method: 'runPullRequestAction', params: { action, number, path } };
    const result = await client.invokeRpc<DeviceGitPullRequestActionResult>(
      scope,
      url ? { method: 'runPullRequestActionByUrl', params: { action, number, path, url } } : legacy,
    );

    // An explicit unknown method means nothing ran. An older device can still
    // use the approved source checkout once it confirms the same GitHub PR.
    if (
      url &&
      !result.success &&
      result.error?.includes('Unknown device RPC method: runPullRequestActionByUrl')
    ) {
      const confirmed = await gitPullRequestDetail(getClient, { ...params, coreOnly: true });
      if (confirmed?.detail?.url.toLowerCase() !== url.toLowerCase()) {
        return { error: 'The pull request does not match the approved repository', success: false };
      }
      const fallback = await client.invokeRpc<DeviceGitPullRequestActionResult>(scope, legacy);
      if (fallback.success && fallback.data) return fallback.data;
      return { error: fallback.error || 'Pull request action failed', success: false };
    }

    if (!result.success || !result.data) {
      log('runGitPullRequestAction: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Pull request action failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('runGitPullRequestAction: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Pull request action failed', success: false };
  }
}

/**
 * Revert (discard working-tree changes to) a single file in a directory on a
 * remote device via the `revertGitFile` device RPC.
 */
export async function revertGitFile(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    filePath: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitFileRevertResult> {
  const { userId, deviceId, filePath, path, timeout = 15_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitFileRevertResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'revertGitFile', params: { filePath, path } },
    );

    if (!result.success || !result.data) {
      log('revertGitFile: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Revert failed', success: false };
    }

    return result.data;
  } catch (error) {
    log('revertGitFile: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error)?.message || 'Revert failed', success: false };
  }
}
