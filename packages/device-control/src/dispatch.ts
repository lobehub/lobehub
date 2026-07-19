import {
  addGitWorktree,
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
  listGitWorktrees,
  moveLocalFiles,
  pullGitBranch,
  pushGitBranch,
  removeGitWorktree,
  renameGitBranch,
  renameLocalFile,
  revertGitFile,
  writeLocalFile,
} from '@lobechat/local-file-shell';

import { prepareSkillDirectory } from './skillDirectory';
import type {
  DeviceControlDeps,
  EnrollWorkspaceParams,
  InitWorkspaceParams,
  ListHeterogeneousAgentModelsParams,
  ListProjectSkillsParams,
  LocalFilePreviewUrlParams,
  PrepareSkillDirectoryParams,
  ProjectFileIndexParams,
  ProjectFileSearchParams,
  UnenrollWorkspaceParams,
} from './types';
import { initWorkspace, listProjectSkills, statPath } from './workspace';

/**
 * Every method name the device-control RPC dispatcher understands. Mirrors the
 * gateway's server-internal RPC surface — the gateway routes any `rpc_request`
 * by `method` here, so adding a device capability means one entry below plus its
 * handler, with no per-method gateway route.
 */
export const DEVICE_RPC_METHODS = [
  'enrollWorkspace',
  'unenrollWorkspace',
  'initWorkspace',
  'listHeterogeneousAgentModels',
  'listProjectSkills',
  'prepareSkillDirectory',
  'statPath',
  'getProjectFileIndex',
  'searchProjectFiles',
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
  'listGitWorktrees',
  'checkoutGitBranch',
  'renameGitBranch',
  'deleteGitBranch',
  'removeGitWorktree',
  'addGitWorktree',
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
    // Remote workspace share: the host owns the gateway connections, so both
    // handlers are host-injected. A host that can't manage a second connection
    // rejects with a stable reason the server surfaces to the user.
    case 'enrollWorkspace': {
      if (!deps.enrollWorkspace)
        throw new Error('This device client does not support workspace sharing');
      return deps.enrollWorkspace(params as EnrollWorkspaceParams);
    }

    case 'unenrollWorkspace': {
      if (!deps.unenrollWorkspace)
        throw new Error('This device client does not support workspace sharing');
      return deps.unenrollWorkspace(params as UnenrollWorkspaceParams);
    }

    case 'initWorkspace': {
      return initWorkspace(params as InitWorkspaceParams, deps);
    }

    case 'listHeterogeneousAgentModels': {
      if (!deps.listHeterogeneousAgentModels) {
        throw new Error('This device client does not support heterogeneous agent model discovery');
      }
      return deps.listHeterogeneousAgentModels(params as ListHeterogeneousAgentModelsParams);
    }

    case 'listProjectSkills': {
      return listProjectSkills(params as ListProjectSkillsParams, deps);
    }

    case 'prepareSkillDirectory': {
      return prepareSkillDirectory(params as PrepareSkillDirectoryParams, deps);
    }

    case 'statPath': {
      return statPath(params as { path: string });
    }

    case 'getProjectFileIndex': {
      return deps.getProjectFileIndex(params as ProjectFileIndexParams);
    }

    case 'searchProjectFiles': {
      return deps.searchProjectFiles(params as ProjectFileSearchParams);
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
      return getLinkedPullRequest(
        params as { branch: string; path: string; pullRequestNumber?: number },
      );
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

    case 'listGitWorktrees': {
      return listGitWorktrees((params as { path: string }).path);
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

    case 'removeGitWorktree': {
      return removeGitWorktree(params as { path: string; worktreePath: string });
    }

    case 'addGitWorktree': {
      return addGitWorktree(params as { branch: string; path: string; worktreePath: string });
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
