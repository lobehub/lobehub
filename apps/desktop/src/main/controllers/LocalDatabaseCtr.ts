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
  async batch(operations: DesktopLocalDatabaseBatchOperation[]): Promise<void> {
    await this.service.batch(operations);
  }

  @IpcMethod()
  async delete({ collection, key }: DesktopLocalDatabaseKey): Promise<void> {
    await this.service.delete(collection, key);
  }

  @IpcMethod()
  async deleteByPrefix({ collection, prefix }: DesktopLocalDatabasePrefix): Promise<void> {
    await this.service.deleteByPrefix(collection, prefix);
  }

  @IpcMethod()
  async entriesByPrefix({
    collection,
    prefix,
  }: DesktopLocalDatabasePrefix): Promise<DesktopLocalDatabaseEntry[]> {
    return this.service.entriesByPrefix(collection, prefix);
  }

  @IpcMethod()
  async get({ collection, key }: DesktopLocalDatabaseKey): Promise<string | undefined> {
    return this.service.get(collection, key);
  }

  @IpcMethod()
  async set({ collection, key, value }: DesktopLocalDatabaseSet): Promise<void> {
    await this.service.set(collection, key, value);
  }
}
