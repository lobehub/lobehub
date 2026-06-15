import {
  checkoutGitBranch,
  deleteGitBranch,
  getGitAheadBehind,
  getGitBranch,
  getGitBranchDiff,
  getGitWorkingTreeFiles,
  getGitWorkingTreePatches,
  getGitWorkingTreeStatus,
  getLinkedPullRequest,
  listGitBranches,
  listGitRemoteBranches,
  moveLocalFiles,
  pullGitBranch,
  pushGitBranch,
  renameGitBranch,
  renameLocalFile,
  revertGitFile,
  writeLocalFile,
} from '@lobechat/local-file-shell';

import type {
  DeviceControlDeps,
  InitWorkspaceParams,
  ListProjectSkillsParams,
  LocalFilePreviewUrlParams,
  ProjectFileIndexParams,
} from './types';
import { initWorkspace, listProjectSkills, statPath } from './workspace';

/**
 * Every method name the device-control RPC dispatcher understands. Mirrors the
 * gateway's server-internal RPC surface — the gateway routes any `rpc_request`
 * by `method` here, so adding a device capability means one entry below plus its
 * handler, with no per-method gateway route.
 */
export const DEVICE_RPC_METHODS = [
  'initWorkspace',
  'listProjectSkills',
  'statPath',
  'getProjectFileIndex',
  'getLocalFilePreview',
  'moveLocalFiles',
  'renameLocalFile',
  'writeLocalFile',
  'getGitBranch',
  'getLinkedPullRequest',
  'getGitWorkingTreeStatus',
  'getGitWorkingTreeFiles',
  'getGitWorkingTreePatches',
  'getGitBranchDiff',
  'getGitAheadBehind',
  'listGitBranches',
  'listGitRemoteBranches',
  'checkoutGitBranch',
  'renameGitBranch',
  'deleteGitBranch',
  'pullGitBranch',
  'pushGitBranch',
  'revertGitFile',
] as const;

export type DeviceRpcMethod = (typeof DEVICE_RPC_METHODS)[number];

/**
 * Dispatch a generic server-internal device RPC by method name. This is the
 * single device-control entry point shared by the desktop main process
 * (`GatewayConnectionCtr`) and the CLI daemon (`lh connect`); both hand it the
 * raw `(method, params)` off the gateway WebSocket and inject their own
 * platform-specific `deps`.
 *
 * Git and workspace-scan methods run identical shared logic on every host; only
 * `getProjectFileIndex` / `getLocalFilePreview` (and the workspace-scan preview
 * approval) vary per host and come from `deps`.
 */
export const executeDeviceRpc = async (
  method: string,
  params: unknown,
  deps: DeviceControlDeps,
): Promise<unknown> => {
  switch (method) {
    case 'initWorkspace': {
      return initWorkspace(params as InitWorkspaceParams, deps);
    }

    case 'listProjectSkills': {
      return listProjectSkills(params as ListProjectSkillsParams, deps);
    }

    case 'statPath': {
      return statPath(params as { path: string });
    }

    case 'getProjectFileIndex': {
      return deps.getProjectFileIndex(params as ProjectFileIndexParams);
    }

    case 'getLocalFilePreview': {
      return deps.getLocalFilePreview(params as LocalFilePreviewUrlParams);
    }

    case 'moveLocalFiles': {
      return moveLocalFiles(params as { items: { newPath: string; oldPath: string }[] });
    }

    case 'renameLocalFile': {
      return renameLocalFile(params as { newName: string; path: string });
    }

    case 'writeLocalFile': {
      return writeLocalFile(params as { content: string; path: string });
    }

    case 'getGitBranch': {
      return getGitBranch((params as { path: string }).path);
    }

    case 'getLinkedPullRequest': {
      return getLinkedPullRequest(params as { branch: string; path: string });
    }

    case 'getGitWorkingTreeStatus': {
      return getGitWorkingTreeStatus((params as { path: string }).path);
    }

    case 'getGitWorkingTreeFiles': {
      return getGitWorkingTreeFiles((params as { path: string }).path);
    }

    case 'getGitWorkingTreePatches': {
      return getGitWorkingTreePatches((params as { path: string }).path);
    }

    case 'getGitBranchDiff': {
      return getGitBranchDiff(params as { baseRef?: string; path: string });
    }

    case 'getGitAheadBehind': {
      return getGitAheadBehind((params as { path: string }).path);
    }

    case 'listGitBranches': {
      return listGitBranches((params as { path: string }).path);
    }

    case 'listGitRemoteBranches': {
      return listGitRemoteBranches((params as { path: string }).path);
    }

    case 'checkoutGitBranch': {
      return checkoutGitBranch(params as { branch: string; create?: boolean; path: string });
    }

    case 'renameGitBranch': {
      return renameGitBranch(params as { from: string; path: string; to: string });
    }

    case 'deleteGitBranch': {
      return deleteGitBranch(params as { branch: string; path: string });
    }

    case 'pullGitBranch': {
      return pullGitBranch(params as { path: string });
    }

    case 'pushGitBranch': {
      return pushGitBranch(params as { path: string });
    }

    case 'revertGitFile': {
      return revertGitFile(params as { filePath: string; path: string });
    }

    default: {
      throw new Error(`Unknown device RPC method: ${method}`);
    }
  }
};
