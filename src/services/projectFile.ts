import { isDesktop } from '@lobechat/const';
import type {
  LocalFilePreviewUrlParams,
  LocalMoveFilesResultItem,
  MoveLocalFileParams,
  ProjectFileIndexResult,
  ProjectFileSearchResult,
  RenameLocalFileResult,
} from '@lobechat/electron-client-ipc';
import type { DeviceLocalFilePreview } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { type LocalFilePreview, localFileService } from '@/services/electron/localFileService';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';

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
      return preview;
    }
  }
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
    sandboxTopicId,
    scope,
  }: {
    deviceId?: string;
    sandboxTopicId?: string;
    scope: string;
  }): Promise<ProjectFileIndexResult | undefined> {
    if (sandboxTopicId) return this.getSandboxFileIndex({ scope, topicId: sandboxTopicId });

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
    scope,
    topicId,
  }: {
    scope: string;
    topicId: string;
  }): Promise<ProjectFileIndexResult | undefined> {
    const [workspace, listing] = await Promise.all([
      sandboxWorkspaceService.getWorkspace(),
      sandboxWorkspaceService.listFiles({ path: scope || undefined, recursive: true, topicId }),
    ]);

    if (!workspace?.dir) return undefined;

    const prefix = scope ? `${scope}/` : '';
    const root = scope ? `${workspace.dir}/${scope}` : workspace.dir;

    return {
      entries: listing.entries.map((entry) => ({
        isDirectory: entry.isDirectory,
        name: entry.name,
        // The workspace speaks in paths relative to ITS root; the tree resolves
        // everything against the project root it was given.
        path: `${workspace.dir}/${entry.path}`,
        relativePath: entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path,
      })),
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
}

export const projectFileService = new ProjectFileService();
