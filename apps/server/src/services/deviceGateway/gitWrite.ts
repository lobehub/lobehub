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
} from '@lobechat/types';
import debug from 'debug';

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
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitCheckoutResult> {
  const { userId, deviceId, branch, create, path, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitCheckoutResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'checkoutGitBranch', params: { branch, create, path } },
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
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
    worktreePath: string;
  },
): Promise<DeviceGitAddWorktreeResult> {
  const { userId, deviceId, branch, path, worktreePath, workspaceId, timeout = 30_000 } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitAddWorktreeResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'addGitWorktree', params: { branch, path, worktreePath } },
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

/**
 * Pull (`--ff-only`) the current branch of a directory on a remote device via
 * the `pullGitBranch` device RPC.
 */
export async function pullGitBranch(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitSyncResult> {
  const { userId, deviceId, path, timeout = 65_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitSyncResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'pullGitBranch', params: { path } },
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
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitSyncResult> {
  const { userId, deviceId, path, timeout = 65_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitSyncResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'pushGitBranch', params: { path } },
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
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitPullRequestActionResult> {
  const { userId, deviceId, path, number, action, timeout = 65_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceGitPullRequestActionResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'runPullRequestAction', params: { action, number, path } },
    );

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
