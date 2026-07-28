import type {
  DesktopLocalDatabaseBatchOperation,
  DesktopLocalDatabaseEntry,
  DesktopLocalDatabaseKey,
  DesktopLocalDatabasePrefix,
  DesktopLocalDatabaseSet,
} from '@lobechat/electron-client-ipc';

import LocalDatabaseService from '@/services/LocalDatabaseSrv';

import { ControllerModule, IpcMethod } from './index';

export default class LocalDatabaseController extends ControllerModule {
  static override readonly groupName = 'localDatabase';

  private get service() {
    return this.app.getService(LocalDatabaseService);
  }

  @IpcMethod()
  initialize(): void {
    this.service.initialize();
  }

  @IpcMethod()
  batch(operations: DesktopLocalDatabaseBatchOperation[]): void {
    this.service.batch(operations);
  }

  @IpcMethod()
  delete({ collection, key }: DesktopLocalDatabaseKey): void {
    this.service.delete(collection, key);
  }

  @IpcMethod()
  deleteByPrefix({ collection, prefix }: DesktopLocalDatabasePrefix): void {
    this.service.deleteByPrefix(collection, prefix);
  }

  @IpcMethod()
  entriesByPrefix({ collection, prefix }: DesktopLocalDatabasePrefix): DesktopLocalDatabaseEntry[] {
    return this.service.entriesByPrefix(collection, prefix);
  }

  @IpcMethod()
  get({ collection, key }: DesktopLocalDatabaseKey): string | undefined {
    return this.service.get(collection, key)?.value;
  }

  @IpcMethod()
  set({ collection, key, value }: DesktopLocalDatabaseSet): void {
    this.service.set(collection, key, value);
  }
}
