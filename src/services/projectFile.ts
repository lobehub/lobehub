import type {
  LocalFilePreviewUrlParams,
  ProjectFileIndexResult,
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
        deviceId,
        path: params.path,
        workingDirectory: params.workingDirectory,
      });

      if (!result.success || !result.preview) {
        throw new Error(result.error || 'Missing local file preview');
      }

      return deserializeLocalFilePreview(result.preview);
    }

    return localFileService.getLocalFilePreview(params);
  }
}

export const projectFileService = new ProjectFileService();
