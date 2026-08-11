import type {
  DesktopLocalDatabaseBatchOperation,
  DesktopLocalDatabaseCollectionInfo,
  DesktopLocalDatabaseEntry,
  DesktopLocalDatabaseKey,
  DesktopLocalDatabasePrefix,
  DesktopLocalDatabaseSet,
} from '@lobechat/electron-client-ipc';

import LocalDatabaseService from '@/services/LocalDatabaseSrv';
import ProjectionCacheService from '@/services/ProjectionCacheSrv';

import { ControllerModule, IpcMethod } from './index';

export default class LocalDatabaseController extends ControllerModule {
  static override readonly groupName = 'localDatabase';

  private static readonly legacyProjectionCollections = new Set([
    'entity-indexes',
    'entity-meta',
    'entity-records',
    'entity-snapshots',
  ]);

  private get service() {
    return this.app.getService(LocalDatabaseService);
  }

  private get projectionCacheService() {
    return this.app.getService(ProjectionCacheService);
  }

  private assertGenericCollection(collection: string): void {
    if (this.projectionCacheService.isCollection(collection)) {
      throw new Error(
        'Projection cache tables must be mutated through the Projection entity engine',
      );
    }
  }

  @IpcMethod()
  initialize(): void {
    this.service.initialize();
  }

  @IpcMethod()
  async batch(operations: DesktopLocalDatabaseBatchOperation[]): Promise<void> {
    for (const operation of operations) this.assertGenericCollection(operation.collection);
    await this.service.batch(operations);
  }

  @IpcMethod()
  async delete({ collection, key }: DesktopLocalDatabaseKey): Promise<void> {
    this.assertGenericCollection(collection);
    await this.service.delete(collection, key);
  }

  @IpcMethod()
  async deleteByPrefix({ collection, prefix }: DesktopLocalDatabasePrefix): Promise<void> {
    this.assertGenericCollection(collection);
    await this.service.deleteByPrefix(collection, prefix);
  }

  @IpcMethod()
  async entriesByPrefix({
    collection,
    prefix,
  }: DesktopLocalDatabasePrefix): Promise<DesktopLocalDatabaseEntry[]> {
    if (this.projectionCacheService.isCollection(collection)) {
      return this.projectionCacheService.inspectEntries(collection, prefix);
    }
    return this.service.entriesByPrefix(collection, prefix);
  }

  @IpcMethod()
  async get({ collection, key }: DesktopLocalDatabaseKey): Promise<string | undefined> {
    if (this.projectionCacheService.isCollection(collection)) {
      return (await this.projectionCacheService.inspectEntries(collection, key)).find(
        (entry) => entry.key === key,
      )?.value;
    }
    return this.service.get(collection, key);
  }

  @IpcMethod()
  async listCollections(): Promise<DesktopLocalDatabaseCollectionInfo[]> {
    const [generic, projection] = await Promise.all([
      this.service.listCollections(),
      this.projectionCacheService.listCollections(),
    ]);

    return [...generic, ...projection]
      .filter(({ name }) => !LocalDatabaseController.legacyProjectionCollections.has(name))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  @IpcMethod()
  async set({ collection, key, value }: DesktopLocalDatabaseSet): Promise<void> {
    this.assertGenericCollection(collection);
    await this.service.set(collection, key, value);
  }
}
