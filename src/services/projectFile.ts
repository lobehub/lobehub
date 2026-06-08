import type { ProjectFileIndexResult } from '@lobechat/electron-client-ipc';

import { lambdaClient } from '@/libs/trpc/client';
import { localFileService } from '@/services/electron/localFileService';

/**
 * Project file tree chokepoint. Picks the transport per call from `deviceId`: a
 * remote / web target goes through the `device.getProjectFileIndex` RPC; the
 * local desktop talks to Electron over IPC. UI / store only see this service —
 * the electron-vs-lambda decision never leaks up. (Parallels `gitService`.)
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
}

export const projectFileService = new ProjectFileService();
