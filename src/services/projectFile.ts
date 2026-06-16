import type {
  LocalFilePreviewUrlParams,
  LocalMoveFilesResultItem,
  MoveLocalFileParams,
  ProjectFileIndexResult,
  RenameLocalFileResult,
} from '@lobechat/electron-client-ipc';
import type { DeviceLocalFilePreview } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { type LocalFilePreview, localFileService } from '@/services/electron/localFileService';

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
  /** Project file index (tree) for a working directory. */
  async getProjectFileIndex({
    deviceId,
    scope,
  }: {
    deviceId?: string;
    scope: string;
  }): Promise<ProjectFileIndexResult | undefined> {
    return deviceId
      ? ((await lambdaClient.device.getProjectFileIndex.query({ deviceId, scope })) ?? undefined)
      : localFileService.getProjectFileIndex({ scope });
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
