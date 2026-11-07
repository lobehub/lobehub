/**
 * Files-tab reads on a remote device (index, directory, search, preview,
 * skills) and publish-asset copies.
 */
import type {
  DeviceClaudeCodeMemoryRunEnv,
  DeviceCopyAssetForPublishResult,
  DeviceDirectoryBrowseResult,
  DeviceExternalAssetForPublishResult,
  DeviceListClaudeCodeMemoryResult,
  DeviceListProjectSkillsResult,
  DeviceLocalFilePreviewResult,
  DeviceProjectDirectoryListResult,
  DeviceProjectFileIndexResult,
  DeviceProjectFileSearchResult,
} from '@lobechat/types';
import debug from 'debug';

import { assertPathsWithinWorkspace } from './paths';
import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/**
 * Project file index (tree) for a directory on a remote device via the
 * `getProjectFileIndex` device RPC — the Files tab's tree.
 */
export async function getProjectFileIndex(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceProjectFileIndexResult | undefined> {
  const { userId, deviceId, scope, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceProjectFileIndexResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'getProjectFileIndex', params: { scope } },
    );

    if (!result.success || !result.data) {
      log('getProjectFileIndex: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('getProjectFileIndex: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * Children of one directory inside a project on a remote device via the
 * `listProjectDirectory` device RPC — expands a row the index collapsed.
 */
export async function listProjectDirectory(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    relativePath: string;
    root: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceProjectDirectoryListResult | undefined> {
  const { userId, deviceId, relativePath, root, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceProjectDirectoryListResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'listProjectDirectory', params: { relativePath, root } },
    );

    if (!result.success || !result.data) {
      log('listProjectDirectory: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('listProjectDirectory: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/** List one directory level on a remote execution device for folder pickers. */
export async function browseDirectory(
  getClient: DeviceClientGetter,
  params: {
    cursor?: string;
    deviceId: string;
    limit?: number;
    path?: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceDirectoryBrowseResult | undefined> {
  const {
    cursor,
    deviceId,
    limit,
    path: directoryPath,
    timeout = 10_000,
    userId,
    workspaceId,
  } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceDirectoryBrowseResult>(
      { deviceId, timeout, userId, workspaceId },
      {
        method: 'browseDirectory',
        params: { cursor, limit, path: directoryPath },
      },
    );

    if (!result.success || !result.data) {
      log('browseDirectory: failed for deviceId=%s', deviceId);
      return undefined;
    }

    return result.data;
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    log('browseDirectory: error for deviceId=%s (%s)', deviceId, errorType);
    return undefined;
  }
}

/**
 * Project file search for a directory on a remote device via the
 * `searchProjectFiles` device RPC. The device performs matching and returns a
 * compact tree subset with ancestor directories.
 */
export async function searchProjectFiles(
  getClient: DeviceClientGetter,
  params: {
    changedOnly?: boolean;
    deviceId: string;
    excludeIgnored?: boolean;
    limit?: number;
    query: string;
    scope: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceProjectFileSearchResult | undefined> {
  const {
    changedOnly,
    userId,
    deviceId,
    excludeIgnored,
    limit,
    query,
    scope,
    timeout = 30_000,
    workspaceId,
  } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceProjectFileSearchResult>(
      { deviceId, timeout, userId, workspaceId },
      {
        method: 'searchProjectFiles',
        params: { changedOnly, excludeIgnored, limit, query, scope },
      },
    );

    if (!result.success || !result.data) {
      log('searchProjectFiles: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('searchProjectFiles: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * Read a preview payload for a file on a remote device. This is read-only and
 * deliberately mirrors the desktop local-file preview contract without
 * exposing a `localfile://` URL to web callers.
 */
export async function getLocalFilePreview(
  getClient: DeviceClientGetter,
  params: {
    accept?: 'image';
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceLocalFilePreviewResult> {
  const {
    accept,
    userId,
    deviceId,
    path,
    workingDirectory,
    timeout = 30_000,
    workspaceId,
  } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceLocalFilePreviewResult>(
      { deviceId, timeout, userId, workspaceId },
      {
        method: 'getLocalFilePreview',
        params: { accept, path, workingDirectory },
      },
    );

    if (!result.success || !result.data) {
      log('getLocalFilePreview: failed for deviceId=%s — %s', deviceId, result.error);
      return { error: result.error || 'Failed to load local file preview', success: false };
    }

    return result.data;
  } catch (error) {
    log('getLocalFilePreview: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error).message, success: false };
  }
}

export async function copyAssetForPublish(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    from: string;
    timeout?: number;
    to: string;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceCopyAssetForPublishResult> {
  const { userId, deviceId, from, to, workingDirectory, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  assertPathsWithinWorkspace(workingDirectory, [to]);

  try {
    const result = await client.invokeRpc<DeviceCopyAssetForPublishResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'copyAssetForPublish', params: { from, to, workingDirectory } },
    );
    if (!result.success || !result.data) {
      return { error: result.error || 'Failed to copy publish asset', success: false };
    }
    return result.data;
  } catch (error) {
    log('copyAssetForPublish: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error).message, success: false };
  }
}

export async function readExternalAssetForPublish(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceExternalAssetForPublishResult> {
  const { userId, deviceId, path, workingDirectory, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return { error: 'Device gateway not configured', success: false };

  try {
    const result = await client.invokeRpc<DeviceExternalAssetForPublishResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'readExternalAssetForPublish', params: { path, workingDirectory } },
    );
    if (!result.success || !result.data) {
      return { error: result.error || 'Failed to read external publish asset', success: false };
    }
    return result.data;
  } catch (error) {
    log('readExternalAssetForPublish: error for deviceId=%s — %O', deviceId, error);
    return { error: (error as Error).message, success: false };
  }
}

/**
 * Project skills (`.agents/skills` / `.claude/skills`) for a directory on a
 * remote device via the `listProjectSkills` device RPC — the Resources tab's
 * skills group in device mode. Mirrors `getProjectFileIndex`; returns
 * `undefined` when the gateway is unconfigured, the device is offline, or the
 * call fails so the UI degrades to "no skills".
 */
export async function listProjectSkills(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceListProjectSkillsResult | undefined> {
  const { userId, deviceId, scope, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceListProjectSkillsResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'listProjectSkills', params: { scope } },
    );

    if (!result.success || !result.data) {
      log('listProjectSkills: failed for deviceId=%s — %s', deviceId, result.error);
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('listProjectSkills: error for deviceId=%s — %O', deviceId, error);
    return undefined;
  }
}

/**
 * Claude Code's auto memory (`~/.claude/projects/<key>/memory`) for a project
 * on a remote device via the `listClaudeCodeMemory` device RPC — the workspace
 * panel's Memory tab in device mode. Returns `undefined` when the gateway is
 * unconfigured, the device is offline, or the call fails. A client too old to
 * know the method rejects so the UI can distinguish an upgrade from a retry.
 */
export async function listClaudeCodeMemory(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    /** The agent's own `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_PROJECT_DIR_NAME`. */
    env?: DeviceClaudeCodeMemoryRunEnv;
    scope: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceListClaudeCodeMemoryResult | undefined> {
  const { userId, deviceId, env, scope, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) return undefined;

  try {
    const result = await client.invokeRpc<DeviceListClaudeCodeMemoryResult>(
      { deviceId, timeout, userId, workspaceId },
      { method: 'listClaudeCodeMemory', params: { env, scope } },
    );

    if (!result.success || !result.data) {
      log('listClaudeCodeMemory: failed for deviceId=%s — %s', deviceId, result.error);
      if (result.error?.includes('Unknown device RPC method: listClaudeCodeMemory')) {
        throw new Error(result.error);
      }
      return undefined;
    }

    return result.data;
  } catch (error) {
    log('listClaudeCodeMemory: error for deviceId=%s — %O', deviceId, error);
    if (
      error instanceof Error &&
      error.message.includes('Unknown device RPC method: listClaudeCodeMemory')
    ) {
      throw error;
    }
    return undefined;
  }
}
