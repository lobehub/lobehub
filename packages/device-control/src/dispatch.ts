import {
  copyLocalFiles,
  createLocalDirectory,
  createLocalFile,
  moveLocalFiles,
  renameLocalFile,
  writeLocalFile,
} from '@lobechat/local-file-shell/file';
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
  getPullRequestActivity,
  getPullRequestDetail,
  getPullRequestMergeContext,
  type GitPullRequestAction,
  listGitBranches,
  listGitRemoteBranches,
  listGitWorktrees,
  pullGitBranch,
  pushGitBranch,
  removeGitWorktree,
  renameGitBranch,
  revertGitFile,
  runPullRequestAction,
} from '@lobechat/local-file-shell/git';
import type {
  CopyFilesParams,
  CreateDirectoryParams,
  CreateFileParams,
} from '@lobechat/local-file-shell/types';

import { getClaudeCodeQuota, type GetClaudeCodeQuotaParams } from './claudeCodeQuota';
import { getCodexQuota, type GetCodexQuotaParams } from './codexQuota';
import { defaultCopyAssetForPublish, defaultReadExternalAssetForPublish } from './filePreview';
import { getKimiCodeQuota, type GetKimiCodeQuotaParams } from './kimiCodeQuota';
import { listListeningPorts, type ListListeningPortsParams } from './listeningPorts';
import { defaultListProjectDirectory } from './projectFileIndex';
import { prepareSkillDirectory } from './skillDirectory';
import type {
  BrowseDirectoryParams,
  CopyAssetForPublishParams,
  DeviceControlDeps,
  EnrollWorkspaceParams,
  ExternalAssetForPublishParams,
  InitWorkspaceParams,
  ListHeterogeneousAgentModelsParams,
  ListProjectSkillsParams,
  LocalFilePreviewUrlParams,
  PrepareSkillDirectoryParams,
  ProjectDirectoryListParams,
  ProjectFileIndexParams,
  ProjectFileSearchParams,
  TrashLocalFilesParams,
  UnenrollWorkspaceParams,
} from './types';
import { browseDirectory, initWorkspace, listProjectSkills, statPath } from './workspace';
import { assertEntriesWithinWorkspace, WORKSPACE_ESCAPE_MESSAGE } from './workspaceGuard';

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
  'getClaudeCodeQuota',
  'getCodexQuota',
  'getKimiCodeQuota',
  'listProjectSkills',
  'prepareSkillDirectory',
  'browseDirectory',
  'statPath',
  'getProjectFileIndex',
  'listProjectDirectory',
  'searchProjectFiles',
  'getLocalFilePreview',
  'readExternalAssetForPublish',
  'copyAssetForPublish',
  'moveLocalFiles',
  'renameLocalFile',
  'writeLocalFile',
  'createLocalFile',
  'createLocalDirectory',
  'copyLocalFiles',
  'trashLocalFiles',
  'getGitBranch',
  'getLinkedPullRequest',
  'getPullRequestDetail',
  'getPullRequestActivity',
  'getPullRequestMergeContext',
  'runPullRequestAction',
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
  'listListeningPorts',
  'getAppUpdateState',
  'checkAppUpdate',
  'installAppUpdate',
] as const;

export type DeviceRpcMethod = (typeof DEVICE_RPC_METHODS)[number];

/** Why a client without the app-update handlers rejects those RPCs. */
export const APP_UPDATE_UNSUPPORTED_MESSAGE = 'This device client does not support remote updates';

/** Why a client without a recoverable trash (the CLI daemon) rejects `trashLocalFiles`. */
export const TRASH_UNSUPPORTED_MESSAGE = 'This device does not support moving files to the trash';

/** File-mutation params carry the approved workspace root they must stay inside. */
type WorkspaceScoped<T> = T & { workspaceRoot?: string };

/**
 * The file-tree mutations (create / mkdir / copy / trash) always arrive with
 * the workspace root, so a request without one is refused rather than run
 * unchecked.
 */
const guardMutation = async (workspaceRoot: string | undefined, targets: string[]) => {
  if (!workspaceRoot) throw new Error(`${WORKSPACE_ESCAPE_MESSAGE}: missing workspace root`);
  await assertEntriesWithinWorkspace(workspaceRoot, targets);
};

/**
 * move / rename / write predate the root being sent; a server that still omits
 * it keeps working, and every server that sends it gets the device-side check.
 */
const guardLegacyMutation = async (workspaceRoot: string | undefined, targets: string[]) => {
  if (workspaceRoot) await assertEntriesWithinWorkspace(workspaceRoot, targets);
};

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

    case 'getClaudeCodeQuota': {
      return getClaudeCodeQuota(params as GetClaudeCodeQuotaParams);
    }

    case 'getCodexQuota': {
      return getCodexQuota(params as GetCodexQuotaParams);
    }

    case 'getKimiCodeQuota': {
      return getKimiCodeQuota(params as GetKimiCodeQuotaParams);
    }

    case 'listProjectSkills': {
      return listProjectSkills(params as ListProjectSkillsParams, deps);
    }

    case 'prepareSkillDirectory': {
      return prepareSkillDirectory(params as PrepareSkillDirectoryParams, deps);
    }

    case 'listListeningPorts': {
      return listListeningPorts(params as ListListeningPortsParams);
    }

    case 'browseDirectory': {
      return browseDirectory(params as BrowseDirectoryParams);
    }

    case 'statPath': {
      return statPath(params as { path: string });
    }

    case 'getProjectFileIndex': {
      return deps.getProjectFileIndex(params as ProjectFileIndexParams);
    }

    case 'listProjectDirectory': {
      return defaultListProjectDirectory(params as ProjectDirectoryListParams);
    }

    case 'searchProjectFiles': {
      return deps.searchProjectFiles(params as ProjectFileSearchParams);
    }

    case 'getLocalFilePreview': {
      return deps.getLocalFilePreview(params as LocalFilePreviewUrlParams);
    }

    case 'readExternalAssetForPublish': {
      return (deps.readExternalAssetForPublish ?? defaultReadExternalAssetForPublish)(
        params as ExternalAssetForPublishParams,
      );
    }

    case 'copyAssetForPublish': {
      return (deps.copyAssetForPublish ?? defaultCopyAssetForPublish)(
        params as CopyAssetForPublishParams,
      );
    }

    case 'moveLocalFiles': {
      const { workspaceRoot, ...rest } = params as WorkspaceScoped<{
        items: { newPath: string; oldPath: string }[];
      }>;
      await guardLegacyMutation(
        workspaceRoot,
        rest.items.flatMap((item) => [item.oldPath, item.newPath]),
      );
      return moveLocalFiles(rest);
    }

    case 'renameLocalFile': {
      const { workspaceRoot, ...rest } = params as WorkspaceScoped<{
        newName: string;
        path: string;
      }>;
      await guardLegacyMutation(workspaceRoot, [rest.path]);
      return renameLocalFile(rest);
    }

    case 'writeLocalFile': {
      const { workspaceRoot, ...rest } = params as WorkspaceScoped<{
        content: string;
        path: string;
      }>;
      await guardLegacyMutation(workspaceRoot, [rest.path]);
      return writeLocalFile(rest);
    }

    case 'createLocalFile': {
      const { workspaceRoot, ...rest } = params as WorkspaceScoped<CreateFileParams>;
      await guardMutation(workspaceRoot, [rest.path]);
      return createLocalFile(rest);
    }

    case 'createLocalDirectory': {
      const { workspaceRoot, ...rest } = params as WorkspaceScoped<CreateDirectoryParams>;
      await guardMutation(workspaceRoot, [rest.path]);
      return createLocalDirectory(rest);
    }

    case 'copyLocalFiles': {
      const { workspaceRoot, ...rest } = params as WorkspaceScoped<CopyFilesParams>;
      await guardMutation(
        workspaceRoot,
        rest.items.flatMap((item) =>
          item.targetPath === undefined ? [item.sourcePath] : [item.sourcePath, item.targetPath],
        ),
      );
      return copyLocalFiles(rest);
    }

    // Never falls back to a hard delete: a host without a recoverable trash
    // refuses, so a remote "delete" can always be undone.
    case 'trashLocalFiles': {
      const { workspaceRoot, ...rest } = params as WorkspaceScoped<TrashLocalFilesParams>;
      if (!deps.trashLocalFiles) throw new Error(TRASH_UNSUPPORTED_MESSAGE);
      await guardMutation(workspaceRoot, rest.paths);
      return deps.trashLocalFiles(rest);
    }

    case 'getGitBranch': {
      return getGitBranch((params as { path: string }).path);
    }

    case 'getLinkedPullRequest': {
      return getLinkedPullRequest(
        params as { branch: string; path: string; pullRequestNumber?: number },
      );
    }

    case 'getPullRequestDetail': {
      return getPullRequestDetail(params as { coreOnly?: boolean; number: number; path: string });
    }
    case 'getPullRequestActivity': {
      return getPullRequestActivity(params as { number: number; path: string });
    }

    case 'getPullRequestMergeContext': {
      return getPullRequestMergeContext(
        params as {
          baseRefName: string;
          headRefOid: string;
          number: number;
          path: string;
          repo: { name: string; owner: string };
        },
      );
    }

    case 'runPullRequestAction': {
      return runPullRequestAction(
        params as { action: GitPullRequestAction; number: number; path: string },
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

    // Remote app update: only a client that can update itself (the desktop
    // app) injects these, so the CLI answers with a stable reason instead.
    case 'getAppUpdateState': {
      if (!deps.getAppUpdateState) throw new Error(APP_UPDATE_UNSUPPORTED_MESSAGE);
      return deps.getAppUpdateState();
    }

    case 'checkAppUpdate': {
      if (!deps.checkAppUpdate) throw new Error(APP_UPDATE_UNSUPPORTED_MESSAGE);
      return deps.checkAppUpdate();
    }

    case 'installAppUpdate': {
      if (!deps.installAppUpdate) throw new Error(APP_UPDATE_UNSUPPORTED_MESSAGE);
      return deps.installAppUpdate();
    }

    default: {
      throw new Error(`Unknown device RPC method: ${method}`);
    }
  }
};
