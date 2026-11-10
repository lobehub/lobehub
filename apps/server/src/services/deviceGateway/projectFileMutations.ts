/**
 * Files-tab mutations on a remote device. Every path is confined to the
 * workspace, and a failure throws.
 */
import type {
  DeviceCopyProjectFileItem,
  DeviceCopyProjectFileResultItem,
  DeviceCreateProjectEntryResult,
  DeviceMoveProjectFileItem,
  DeviceMoveProjectFileResultItem,
  DeviceRenameProjectFileResult,
  DeviceTrashProjectFilesResult,
  DeviceWriteProjectFileResult,
} from '@lobechat/types';
import { isValidDirectoryName } from '@lobechat/utils/directoryName';
import debug from 'debug';
import { isAbsolute } from 'pathe';

import { assertNotWorkspaceRoot, assertPathsWithinWorkspace, joinDevicePath } from './paths';
import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/**
 * Move one or more files/folders within a directory on a remote device, via
 * the device's `moveLocalFiles` RPC. Powers the Files tree's move in device
 * mode. Unlike the read RPCs this is a user-initiated mutation, so a missing
 * gateway / offline device / failed call throws rather than degrading to
 * `undefined` — the UI surfaces the error instead of silently no-op'ing.
 */
export async function moveProjectFiles(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    items: DeviceMoveProjectFileItem[];
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceMoveProjectFileResultItem[]> {
  const { userId, deviceId, items, workingDirectory, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway not configured');

  assertPathsWithinWorkspace(
    workingDirectory,
    items.flatMap((item) => [item.oldPath, item.newPath]),
  );
  assertNotWorkspaceRoot(
    workingDirectory,
    items.map((item) => item.oldPath),
  );

  const result = await client.invokeRpc<DeviceMoveProjectFileResultItem[]>(
    { deviceId, timeout, userId, workspaceId },
    { method: 'moveLocalFiles', params: { items, workspaceRoot: workingDirectory } },
  );

  if (!result.success || !result.data) {
    log('moveProjectFiles: failed for deviceId=%s — %s', deviceId, result.error);
    throw new Error(result.error || 'Move failed');
  }

  return result.data;
}

/**
 * Rename a single file/folder in a directory on a remote device, via the
 * device's `renameLocalFile` RPC. Like `moveProjectFiles`, a transport failure
 * throws rather than degrading silently.
 */
export async function renameProjectFile(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    newName: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceRenameProjectFileResult> {
  const {
    userId,
    deviceId,
    path,
    newName,
    workingDirectory,
    timeout = 30_000,
    workspaceId,
  } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway not configured');

  // The rename stays in the same directory (the device rejects separators in
  // `newName`), so containing the source path also contains the target.
  assertPathsWithinWorkspace(workingDirectory, [path]);
  assertNotWorkspaceRoot(workingDirectory, [path]);

  const result = await client.invokeRpc<DeviceRenameProjectFileResult>(
    { deviceId, timeout, userId, workspaceId },
    { method: 'renameLocalFile', params: { newName, path, workspaceRoot: workingDirectory } },
  );

  if (!result.success || !result.data) {
    log('renameProjectFile: failed for deviceId=%s — %s', deviceId, result.error);
    throw new Error(result.error || 'Rename failed');
  }

  return result.data;
}

/**
 * Save edited content back to a file on a remote device, via the device's
 * `writeLocalFile` RPC. Powers remote save in the LocalFile editor. Like the
 * other file mutations, a transport failure throws rather than degrading.
 */
export async function writeProjectFile(
  getClient: DeviceClientGetter,
  params: {
    content: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceWriteProjectFileResult> {
  const {
    userId,
    deviceId,
    path,
    content,
    workingDirectory,
    timeout = 30_000,
    workspaceId,
  } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway not configured');

  assertPathsWithinWorkspace(workingDirectory, [path]);

  const result = await client.invokeRpc<DeviceWriteProjectFileResult>(
    { deviceId, timeout, userId, workspaceId },
    { method: 'writeLocalFile', params: { content, path, workspaceRoot: workingDirectory } },
  );

  if (!result.success || !result.data) {
    log('writeProjectFile: failed for deviceId=%s — %s', deviceId, result.error);
    throw new Error(result.error || 'Write failed');
  }

  return result.data;
}

/**
 * Create a new, empty (or seeded) file on a remote device via the device's
 * `createLocalFile` RPC. Never overwrites: an existing entry comes back as
 * `{ success: false, error }`. A transport failure throws.
 */
export async function createProjectFile(
  getClient: DeviceClientGetter,
  params: {
    content?: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceCreateProjectEntryResult> {
  const {
    userId,
    deviceId,
    path,
    content,
    workingDirectory,
    timeout = 30_000,
    workspaceId,
  } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway not configured');

  assertPathsWithinWorkspace(workingDirectory, [path]);

  const result = await client.invokeRpc<DeviceCreateProjectEntryResult>(
    { deviceId, timeout, userId, workspaceId },
    { method: 'createLocalFile', params: { content, path, workspaceRoot: workingDirectory } },
  );

  if (!result.success || !result.data) {
    log('createProjectFile: failed for deviceId=%s — %s', deviceId, result.error);
    throw new Error(result.error || 'Create file failed');
  }

  return result.data;
}

/**
 * Create a new folder on a remote device via the device's
 * `createLocalDirectory` RPC. An existing entry fails instead of being reused.
 */
export async function createProjectDirectory(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceCreateProjectEntryResult> {
  const { userId, deviceId, path, workingDirectory, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway not configured');

  assertPathsWithinWorkspace(workingDirectory, [path]);

  const result = await client.invokeRpc<DeviceCreateProjectEntryResult>(
    { deviceId, timeout, userId, workspaceId },
    { method: 'createLocalDirectory', params: { path, workspaceRoot: workingDirectory } },
  );

  if (!result.success || !result.data) {
    log('createProjectDirectory: failed for deviceId=%s — %s', deviceId, result.error);
    throw new Error(result.error || 'Create folder failed');
  }

  return result.data;
}

/**
 * Create one folder directly inside `parentPath` for the remote folder picker,
 * via the device's `createLocalDirectory` RPC. `parentPath` doubles as the
 * device-side workspace root, so the device guard confines the write to a
 * single new child of the folder being browsed. A device-reported failure
 * (e.g. the name is taken) is returned as `success: false`, not thrown.
 */
export async function createDirectory(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    name: string;
    parentPath: string;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<DeviceCreateProjectEntryResult> {
  const { deviceId, parentPath, timeout = 30_000, userId, workspaceId } = params;
  const name = params.name.trim();
  if (!isValidDirectoryName(params.name, parentPath) || !isValidDirectoryName(name, parentPath))
    throw new Error(`Invalid folder name: ${params.name}`);
  if (!isAbsolute(parentPath)) throw new Error(`Parent path must be absolute: ${parentPath}`);

  const client = getClient();
  if (!client) throw new Error('Device gateway not configured');

  const path = joinDevicePath(parentPath, name);
  assertPathsWithinWorkspace(parentPath, [path]);
  assertNotWorkspaceRoot(parentPath, [path]);

  const result = await client.invokeRpc<DeviceCreateProjectEntryResult>(
    { deviceId, timeout, userId, workspaceId },
    { method: 'createLocalDirectory', params: { path, workspaceRoot: parentPath } },
  );

  if (!result.success || !result.data) {
    log('createDirectory: failed for deviceId=%s — %s', deviceId, result.error);
    throw new Error(result.error || 'Create folder failed');
  }

  return result.data;
}

/**
 * Copy (or, without `targetPath`, duplicate in place) files/folders on a
 * remote device via the device's `copyLocalFiles` RPC. Both ends of every item
 * must stay inside the workspace. A duplicate lands next to its source, so
 * containing the source (and refusing the root itself) contains the copy.
 */
export async function copyProjectFiles(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    items: DeviceCopyProjectFileItem[];
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceCopyProjectFileResultItem[]> {
  const { userId, deviceId, items, workingDirectory, timeout = 60_000, workspaceId } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway not configured');

  assertPathsWithinWorkspace(
    workingDirectory,
    items.flatMap((item) =>
      item.targetPath === undefined ? [item.sourcePath] : [item.sourcePath, item.targetPath],
    ),
  );
  assertNotWorkspaceRoot(
    workingDirectory,
    items.map((item) => item.sourcePath),
  );

  const result = await client.invokeRpc<DeviceCopyProjectFileResultItem[]>(
    { deviceId, timeout, userId, workspaceId },
    { method: 'copyLocalFiles', params: { items, workspaceRoot: workingDirectory } },
  );

  if (!result.success || !result.data) {
    log('copyProjectFiles: failed for deviceId=%s — %s', deviceId, result.error);
    throw new Error(result.error || 'Copy failed');
  }

  return result.data;
}

/**
 * Move files/folders to the remote device's trash via its `trashLocalFiles`
 * RPC. A device without a recoverable trash (the CLI daemon) rejects the RPC,
 * which surfaces here as a thrown error — never as a permanent delete.
 */
export async function trashProjectFiles(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    paths: string[];
    timeout?: number;
    userId: string;
    workingDirectory: string;
    workspaceId?: string;
  },
): Promise<DeviceTrashProjectFilesResult> {
  const { userId, deviceId, paths, workingDirectory, timeout = 30_000, workspaceId } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway not configured');

  assertPathsWithinWorkspace(workingDirectory, paths);
  assertNotWorkspaceRoot(workingDirectory, paths);

  const result = await client.invokeRpc<DeviceTrashProjectFilesResult>(
    { deviceId, timeout, userId, workspaceId },
    { method: 'trashLocalFiles', params: { paths, workspaceRoot: workingDirectory } },
  );

  if (!result.success || !result.data) {
    log('trashProjectFiles: failed for deviceId=%s — %s', deviceId, result.error);
    throw new Error(result.error || 'Move to trash failed');
  }

  return result.data;
}
