import type {
  DesktopProjectionCommit,
  DesktopProjectionHydration,
  DesktopProjectionScope,
} from '@lobechat/electron-client-ipc';

import ProjectionCacheService from '@/services/ProjectionCacheSrv';

import { ControllerModule, IpcMethod } from './index';

export default class ProjectionCacheController extends ControllerModule {
  static override readonly groupName = 'projectionCache';

  private get service() {
    return this.app.getService(ProjectionCacheService);
  }

  @IpcMethod()
  async clearScope({ scope }: DesktopProjectionScope): Promise<void> {
    await this.service.clearScope(scope);
  }

  @IpcMethod()
  async commit(commit: DesktopProjectionCommit): Promise<void> {
    await this.service.commit(commit);
  }

  @IpcMethod()
  async hydrateScope({ scope }: DesktopProjectionScope): Promise<DesktopProjectionHydration> {
    return this.service.hydrateScope(scope);
  }
}
