/**
 * Best-effort git reads on a remote device; a failure reads as "unknown" (`undefined`).
 */
import type {
  DeviceGitAheadBehind,
  DeviceGitBranchDiffPatches,
  DeviceGitBranchInfo,
  DeviceGitBranchListItem,
  DeviceGitLinkedPullRequestResult,
  DeviceGitPullRequestActivity,
  DeviceGitPullRequestDetailResult,
  DeviceGitPullRequestMergeContext,
  DeviceGitRemoteBranchListItem,
  DeviceGitResolveWorktreeBaseResult,
  DeviceGitWorkingTreeFiles,
  DeviceGitWorkingTreePatches,
  DeviceGitWorkingTreeStatus,
  DeviceGitWorktreeListItem,
} from '@lobechat/types';
import debug from 'debug';

import { invokeDeviceRead } from './deviceRead';
import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/** Branch name + detached flag for a directory on a remote device. */
export function gitBranch(
  getClient: DeviceClientGetter,
  params: { deviceId: string; path: string; userId: string; workspaceId?: string },
) {
  return invokeDeviceRead<DeviceGitBranchInfo>(getClient, 'getGitBranch', params, {
    path: params.path,
  });
}

/** The GitHub PR linked to a branch in a directory on a remote device. */
export function gitLinkedPullRequest(
  getClient: DeviceClientGetter,
  params: {
    branch: string;
    deviceId: string;
    path: string;
    pullRequestNumber?: number;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<DeviceGitLinkedPullRequestResult>(
    getClient,
    'getLinkedPullRequest',
    params,
    {
      branch: params.branch,
      path: params.path,
      pullRequestNumber: params.pullRequestNumber,
    },
  );
}

/** Full detail of a pull request in a directory on a remote device. */
export function gitPullRequestDetail(
  getClient: DeviceClientGetter,
  params: {
    coreOnly?: boolean;
    deviceId: string;
    number: number;
    path: string;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<DeviceGitPullRequestDetailResult>(
    getClient,
    'getPullRequestDetail',
    { ...params, timeout: 20_000 },
    {
      coreOnly: params.coreOnly,
      number: params.number,
      path: params.path,
    },
  );
}

export function gitPullRequestActivity(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    number: number;
    path: string;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<DeviceGitPullRequestActivity>(
    getClient,
    'getPullRequestActivity',
    { ...params, timeout: 20_000 },
    {
      number: params.number,
      path: params.path,
    },
  );
}

/** Branch-protection / permission context for a pull request on a remote device. */
export function gitPullRequestMergeContext(
  getClient: DeviceClientGetter,
  params: {
    baseRefName: string;
    deviceId: string;
    headRefOid: string;
    number: number;
    path: string;
    repo: { name: string; owner: string };
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<DeviceGitPullRequestMergeContext>(
    getClient,
    'getPullRequestMergeContext',
    { ...params, timeout: 20_000 },
    {
      baseRefName: params.baseRefName,
      headRefOid: params.headRefOid,
      number: params.number,
      path: params.path,
      repo: params.repo,
    },
  );
}

/** Working-tree dirty-file counts for a directory on a remote device. */
export function gitWorkingTreeStatus(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<DeviceGitWorkingTreeStatus>(
    getClient,
    'getGitWorkingTreeStatus',
    params,
    {
      path: params.path,
    },
  );
}

/** Ahead/behind commit counts for a directory on a remote device. */
export function gitAheadBehind(
  getClient: DeviceClientGetter,
  params: { deviceId: string; path: string; userId: string; workspaceId?: string },
) {
  return invokeDeviceRead<DeviceGitAheadBehind>(getClient, 'getGitAheadBehind', params, {
    path: params.path,
  });
}

/** Git worktrees attached to the same repository as a directory on a remote device. */
export function listGitWorktrees(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<DeviceGitWorktreeListItem[]>(getClient, 'listGitWorktrees', params, {
    path: params.path,
  });
}

/** What a new worktree in a directory on a remote device would fork from. */
export function resolveGitWorktreeBase(
  getClient: DeviceClientGetter,
  params: {
    baseRef?: string;
    deviceId: string;
    path: string;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<DeviceGitResolveWorktreeBaseResult>(
    getClient,
    'resolveGitWorktreeBase',
    params,
    { baseRef: params.baseRef, path: params.path },
  );
}

/**
 * List the local branches of a directory on a remote device via the
 * `listGitBranches` device RPC, so the web/remote branch switcher can populate
 * the same dropdown the local desktop renders over IPC.
 */
export async function listGitBranches(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitBranchListItem[] | undefined> {
  const { userId, deviceId, path, timeout = 15_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceGitBranchListItem[]>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'listGitBranches', params: { path } },
    );

    if (!result.success || !result.data) {
      log('listGitBranches: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('listGitBranches: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * Working-tree (unstaged) per-file patches for a directory on a remote device
 * via the `getGitWorkingTreePatches` device RPC, so the web/remote Review panel
 * renders the same diffs the local desktop shows over IPC.
 */
export async function getGitWorkingTreePatches(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitWorkingTreePatches | undefined> {
  const { userId, deviceId, path, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceGitWorkingTreePatches>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'getGitWorkingTreePatches', params: { path } },
    );

    if (!result.success || !result.data) {
      log('getGitWorkingTreePatches: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('getGitWorkingTreePatches: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * Branch diff (current branch vs base ref) per-file patches for a directory on
 * a remote device via the `getGitBranchDiff` device RPC.
 */
export async function getGitBranchDiff(
  getClient: DeviceClientGetter,
  params: {
    baseRef?: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitBranchDiffPatches | undefined> {
  const { userId, deviceId, baseRef, path, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceGitBranchDiffPatches>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'getGitBranchDiff', params: { baseRef, path } },
    );

    if (!result.success || !result.data) {
      log('getGitBranchDiff: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('getGitBranchDiff: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * Repo-relative paths of dirty working-tree files for a directory on a remote
 * device via the `getGitWorkingTreeFiles` device RPC — the Files tab's git
 * status overlay.
 */
export async function getGitWorkingTreeFiles(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitWorkingTreeFiles | undefined> {
  const { userId, deviceId, path, timeout = 15_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceGitWorkingTreeFiles>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'getGitWorkingTreeFiles', params: { path } },
    );

    if (!result.success || !result.data) {
      log('getGitWorkingTreeFiles: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('getGitWorkingTreeFiles: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * List the remote branches (`refs/remotes/origin/*`) of a directory on a
 * remote device via the `listGitRemoteBranches` device RPC, so the web/remote
 * Review base-ref picker mirrors the local desktop's.
 */
export async function listGitRemoteBranches(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceGitRemoteBranchListItem[] | undefined> {
  const { userId, deviceId, path, timeout = 15_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceGitRemoteBranchListItem[]>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'listGitRemoteBranches', params: { path } },
    );

    if (!result.success || !result.data) {
      log('listGitRemoteBranches: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('listGitRemoteBranches: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}
