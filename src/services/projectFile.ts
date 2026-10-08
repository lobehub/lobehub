import { isDesktop } from '@lobechat/const';
import type {
  CopyLocalFileItem,
  CreateLocalEntryResult,
  LocalCopyFilesResultItem,
  LocalFilePreviewUrlParams,
  LocalMoveFilesResultItem,
  MoveLocalFileParams,
  ProjectDirectoryListResult,
  ProjectFileIndexResult,
  ProjectFileSearchResult,
  RenameLocalFileResult,
  TrashLocalFilesResult,
} from '@lobechat/electron-client-ipc';
import type { DeviceLocalFilePreview } from '@lobechat/types';
import { isAbsolute, relative, resolve } from 'pathe';

import { mutate } from '@/libs/swr';
import { localFileKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { type LocalFilePreview, localFileService } from '@/services/electron/localFileService';
import { sandboxStorageService } from '@/services/sandboxStorage';

export type { LocalFilePreview } from '@/services/electron/localFileService';

export interface GetLocalFilePreviewParams extends LocalFilePreviewUrlParams {
  deviceId?: string;
}

const base64ToBlob = (base64: string, contentType: string): Blob => {
  const bytes = Uint8Array.from(globalThis.atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: contentType });
};

const deserializeLocalFilePreview = (preview: DeviceLocalFilePreview): LocalFilePreview => {
  switch (preview.type) {
    case 'document': {
      return {
        blob: base64ToBlob(preview.base64, preview.contentType),
        contentType: preview.contentType,
        type: 'document',
      };
    }

    case 'image': {
      return {
        blob: base64ToBlob(preview.base64, preview.contentType),
        contentType: preview.contentType,
        type: 'image',
      };
    }

    case 'text': {
      return preview;
    }

    default: {
      // Remote devices never ship video bytes over RPC, so there is nothing to play.
      return {
        contentType: preview.contentType,
        type: preview.type === 'video' ? 'binary' : preview.type,
      };
    }
  }
};

/**
 * Refuse to trash / rename / move / duplicate the workspace root itself: it
 * would pull the whole tree out from under the UI (and a duplicate would land
 * outside the workspace). Checked here for both transports so the local IPC
 * path gets the same guard the device gateway enforces server-side.
 */
const assertNotWorkspaceRoot = (workingDirectory: string, paths: string[]): void => {
  if (!workingDirectory) return;
  for (const target of paths) {
    if (isAbsolute(target) && relative(resolve(workingDirectory), resolve(target)) === '') {
      throw new Error(`This operation is not allowed on the workspace root: ${target}`);
    }
  }
};

/**
 * Revalidate everything the Files tree reads for a working directory — the
 * file index and the git dirty-file overlay — after a file operation changed
 * it. There is no file watcher, so without this a mutation only shows up on
 * the next window focus.
 */
export const refreshProjectFiles = async (
  deviceId: string | undefined,
  dirPath: string,
): Promise<void> => {
  await Promise.all([
    mutate(localFileKeys.projectIndex(deviceId, dirPath)),
    mutate(localFileKeys.gitWorkingTreeFiles(deviceId, dirPath)),
  ]);
};

/**
 * Project file chokepoint. Picks the transport per call from `deviceId`: a
 * remote / web target goes through the device RPCs; the local desktop talks to
 * Electron over IPC / preview URLs. UI / store only see this service — the
 * electron-vs-lambda decision never leaks up. (Parallels `gitService`.)
 */
class ProjectFileService {
  /**
   * Project file index (tree) for a working directory.
   *
   * A third host, alongside the device RPC and Electron: the cloud sandbox's
   * persistent workspace, which is reached over the workspace API and named by
   * the topic whose warm session should serve it.
   */
  async getProjectFileIndex({
    deviceId,
    sandboxInstanceId,
    sandboxTopicId,
    scope,
  }: {
    deviceId?: string;
    /**
     * Which instance's directory to read. Addressed directly rather than left
     * for the server to derive from the topic, so a tree can be shown before
     * the conversation exists — the way a device's tree needs no conversation
     * either.
     */
    sandboxInstanceId?: string;
    sandboxTopicId?: string;
    scope: string;
  }): Promise<ProjectFileIndexResult | undefined> {
    if (sandboxTopicId || sandboxInstanceId) {
      return this.getSandboxFileIndex({
        instanceId: sandboxInstanceId,
        scope,
        topicId: sandboxTopicId,
      });
    }

    return deviceId
      ? ((await lambdaClient.device.getProjectFileIndex.query({ deviceId, scope })) ?? undefined)
      : localFileService.getProjectFileIndex({ scope });
  }

  /**
   * The sandbox workspace as a file index.
   *
   * Assembled here rather than server-side because the workspace API answers in
   * its own vocabulary — one flat recursive listing of paths relative to the
   * workspace root — and the tree wants a project root with paths relative to
   * it. Nothing on that side knows about git, so there are no ignore rules to
   * report and no collapsed directories to expand: the index is a plain walk,
   * and says so.
   */
  private async getSandboxFileIndex({
    instanceId,
    scope,
    topicId,
  }: {
    instanceId?: string;
    scope: string;
    topicId?: string;
  }): Promise<ProjectFileIndexResult | undefined> {
    const [workspace, listing] = await Promise.all([
      sandboxStorageService.getStorage(),
      // The topic still travels: it names the warm session the read can go
      // through, and is what lets a listing be refreshed before it is served.
      // The instance is the address; the topic is the route.
      sandboxStorageService.listFiles({
        instanceId,
        path: scope || undefined,
        recursive: true,
        topicId,
      }),
    ]);

    if (!workspace?.dir) return undefined;

    const prefix = scope ? `${scope}/` : '';
    const root = scope ? `${workspace.dir}/${scope}` : workspace.dir;

    return {
      entries: listing.entries.map((entry) => {
        // The workspace speaks in paths relative to ITS root; the tree resolves
        // everything against the project root it was given.
        const relative = entry.path.startsWith(prefix)
          ? entry.path.slice(prefix.length)
          : entry.path;

        return {
          isDirectory: entry.isDirectory,
          name: entry.name,
          path: `${workspace.dir}/${entry.path}`,
          // A directory's path carries a trailing slash, which is how every
          // consumer of this index tells a directory row from a file row by
          // its id alone: the tree derives each row's parent by trimming the
          // last segment and looking the result up. Without it nothing finds
          // its parent, and a whole checkout lands flat at the project root.
          relativePath: entry.isDirectory ? `${relative}/` : relative,
        };
      }),
      indexedAt: new Date().toISOString(),
      root,
      source: 'sandbox',
      truncated: listing.truncated,
    };
  }

  /** Search files within a project working directory. Matching runs on the file host. */
  async searchProjectFiles({
    changedOnly,
    deviceId,
    excludeIgnored,
    limit,
    query,
    scope,
  }: {
    changedOnly?: boolean;
    deviceId?: string;
    excludeIgnored?: boolean;
    limit?: number;
    query: string;
    scope: string;
  }): Promise<ProjectFileSearchResult | undefined> {
    return deviceId
      ? ((await lambdaClient.device.searchProjectFiles.query({
          changedOnly,
          deviceId,
          excludeIgnored,
          limit,
          query,
          scope,
        })) ?? undefined)
      : localFileService.searchProjectFiles({ changedOnly, excludeIgnored, limit, query, scope });
  }

  /**
   * Children of one directory the index collapsed (a fully git-ignored folder),
   * read on demand when the user expands that row in the tree.
   */
  async listProjectDirectory({
    deviceId,
    relativePath,
    root,
  }: {
    deviceId?: string;
    relativePath: string;
    root: string;
  }): Promise<ProjectDirectoryListResult | undefined> {
    return deviceId
      ? ((await lambdaClient.device.listProjectDirectory.query({ deviceId, relativePath, root })) ??
          undefined)
      : localFileService.listProjectDirectory({ relativePath, root });
  }

  /** File preview payload for a file in a project working directory. */
  async getLocalFilePreview({
    deviceId,
    ...params
  }: GetLocalFilePreviewParams): Promise<LocalFilePreview> {
    if (deviceId) {
      const result = await lambdaClient.device.getLocalFilePreview.query({
        accept: params.accept,
        deviceId,
        path: params.path,
        workingDirectory: params.workingDirectory,
      });

      if (!result.success || !result.preview) {
        throw new Error(result.error || 'Missing local file preview');
      }

      if (params.accept === 'image' && result.preview.type !== 'image') {
        throw new Error('Unsupported local file preview type');
      }

      return deserializeLocalFilePreview(result.preview);
    }

    return localFileService.getLocalFilePreview(params);
  }

  /**
   * Raw bytes for a file in a project working directory. Only the local desktop
   * transport can serve bytes today — remote devices have no byte-read RPC yet,
   * so device-backed calls resolve to `undefined`.
   */
  async readProjectFileBytes({
    deviceId,
    path,
    workingDirectory,
  }: {
    deviceId?: string;
    path: string;
    workingDirectory: string;
  }): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    if (deviceId || !isDesktop) return undefined;
    return localFileService.readLocalFileBytes({ path, workingDirectory });
  }

  async readExternalAssetForPublish({
    deviceId,
    path,
    workingDirectory,
  }: {
    deviceId?: string;
    path: string;
    workingDirectory: string;
  }): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    if (!deviceId) {
      return localFileService.readExternalAssetForPublish({ path, workingDirectory });
    }

    const result = await lambdaClient.device.readExternalAssetForPublish.query({
      deviceId,
      path,
      workingDirectory,
    });
    if (!result.success || result.base64 === undefined || !result.contentType) return;

    return {
      bytes: Uint8Array.from(globalThis.atob(result.base64), (char) => char.charCodeAt(0)),
      contentType: result.contentType,
    };
  }

  async copyAssetForPublish({
    deviceId,
    from,
    to,
    workingDirectory,
  }: {
    deviceId?: string;
    from: string;
    to: string;
    workingDirectory: string;
  }): Promise<{ error?: string; success: boolean }> {
    return deviceId
      ? lambdaClient.device.copyAssetForPublish.mutate({ deviceId, from, to, workingDirectory })
      : localFileService.copyAssetForPublish({ from, to, workingDirectory });
  }

  /**
   * Move one or more files/folders within a project working directory. Batched:
   * each item succeeds or fails independently.
   */
  async moveProjectFiles({
    deviceId,
    items,
    workingDirectory,
  }: {
    deviceId?: string;
    items: MoveLocalFileParams[];
    workingDirectory: string;
  }): Promise<LocalMoveFilesResultItem[]> {
    assertNotWorkspaceRoot(
      workingDirectory,
      items.map((item) => item.oldPath),
    );

    return deviceId
      ? lambdaClient.device.moveProjectFiles.mutate({ deviceId, items, workingDirectory })
      : localFileService.moveLocalFiles({ items });
  }

  /** Rename a single file/folder in a project working directory. */
  async renameProjectFile({
    deviceId,
    newName,
    path,
    workingDirectory,
  }: {
    deviceId?: string;
    newName: string;
    path: string;
    workingDirectory: string;
  }): Promise<RenameLocalFileResult> {
    assertNotWorkspaceRoot(workingDirectory, [path]);

    return deviceId
      ? lambdaClient.device.renameProjectFile.mutate({ deviceId, newName, path, workingDirectory })
      : localFileService.renameLocalFile({ newName, path });
  }

  /**
   * Save edited content back to a file in a project working directory. The
   * remote RPC and local IPC both report fs failures (permission denied, etc.)
   * as `{ success: false, error }` — callers must inspect `success` before
   * treating the save as complete.
   */
  async writeProjectFile({
    content,
    deviceId,
    path,
    workingDirectory,
  }: {
    content: string;
    deviceId?: string;
    path: string;
    workingDirectory: string;
  }): Promise<{ error?: string; success: boolean }> {
    return deviceId
      ? lambdaClient.device.writeProjectFile.mutate({ content, deviceId, path, workingDirectory })
      : localFileService.writeFile({ content, path });
  }

  /**
   * Create a new file in a project working directory (empty unless `content`
   * is given). Never overwrites: an existing entry resolves `{ success: false }`.
   */
  async createProjectFile({
    content,
    deviceId,
    path,
    workingDirectory,
  }: {
    content?: string;
    deviceId?: string;
    path: string;
    workingDirectory: string;
  }): Promise<CreateLocalEntryResult> {
    return deviceId
      ? lambdaClient.device.createProjectFile.mutate({ content, deviceId, path, workingDirectory })
      : localFileService.createLocalFile({ content, path });
  }

  /** Create a new folder in a project working directory. Fails when the path is taken. */
  async createProjectDirectory({
    deviceId,
    path,
    workingDirectory,
  }: {
    deviceId?: string;
    path: string;
    workingDirectory: string;
  }): Promise<CreateLocalEntryResult> {
    return deviceId
      ? lambdaClient.device.createProjectDirectory.mutate({ deviceId, path, workingDirectory })
      : localFileService.createLocalDirectory({ path });
  }

  /**
   * Copy files/folders within a project working directory. An item without
   * `targetPath` is duplicated next to its source (`name copy.ext`). Never
   * overwrites; each item succeeds or fails independently.
   */
  async copyProjectFiles({
    deviceId,
    items,
    workingDirectory,
  }: {
    deviceId?: string;
    items: CopyLocalFileItem[];
    workingDirectory: string;
  }): Promise<LocalCopyFilesResultItem[]> {
    assertNotWorkspaceRoot(
      workingDirectory,
      items.map((item) => item.sourcePath),
    );

    return deviceId
      ? lambdaClient.device.copyProjectFiles.mutate({ deviceId, items, workingDirectory })
      : localFileService.copyLocalFiles({ items });
  }

  /**
   * Move files/folders in a project working directory to the trash. Reports
   * each path. A remote device without a trash (the CLI daemon) rejects the
   * whole call rather than deleting permanently.
   */
  async trashProjectFiles({
    deviceId,
    paths,
    workingDirectory,
  }: {
    deviceId?: string;
    paths: string[];
    workingDirectory: string;
  }): Promise<TrashLocalFilesResult> {
    assertNotWorkspaceRoot(workingDirectory, paths);

    return deviceId
      ? lambdaClient.device.trashProjectFiles.mutate({ deviceId, paths, workingDirectory })
      : localFileService.trashLocalFiles({ paths });
  }
}

export const projectFileService = new ProjectFileService();
