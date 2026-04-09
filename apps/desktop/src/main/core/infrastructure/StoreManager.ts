import Store from 'electron-store';

import { STORE_DEFAULTS, STORE_NAME } from '@/const/store';
import type { ElectronMainStore, StoreKey } from '@/types/store';
import { makeSureDirExist } from '@/utils/file-system';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';
import { runStoreMigrations } from './migration';

// Create logger
const logger = createLogger('core:StoreManager');

/**
 * Application configuration storage manager
 */
export class StoreManager {
  /**
   * Global configuration store instance
   */
  private store: Store<ElectronMainStore>;
  private app: App;

  constructor(app: App) {
    logger.debug('Initializing StoreManager');
    this.app = app;
    this.store = new Store<ElectronMainStore>({
      defaults: STORE_DEFAULTS,
      name: STORE_NAME,
    });
    runStoreMigrations(this.store);
    logger.info('StoreManager initialized with store name:', STORE_NAME);

    const storagePath = this.store.get('storagePath');
    logger.info('app storage path:', storagePath);

    makeSureDirExist(storagePath);
  }

  /**
   * Get configuration item
   * @param key Configuration key
   * @param defaultValue Default value
   */
  get<K extends StoreKey>(key: K, defaultValue?: ElectronMainStore[K]): ElectronMainStore[K] {
    logger.debug('Getting configuration value for key:', key);
    return this.store.get(key, defaultValue as any);
  }

  /**
   * Set configuration item
   * @param key Configuration key
   * @param value Configuration value
   */
  set<K extends StoreKey>(key: K, value: ElectronMainStore[K]): void {
    logger.debug('Setting configuration value for key:', key);
    this.store.set(key, value);
  }

  /**
   * Delete configuration item
   * @param key Configuration key
   */
  delete(key: StoreKey): void {
    logger.debug('Deleting configuration key:', key);
    this.store.delete(key);
  }

  /**
   * Clear all storage
   */
  clear(): void {
    logger.warn('Clearing all store data');
    this.store.clear();
  }

  /**
   * Check if a configuration item exists
   * @param key Configuration key
   */
  has(key: StoreKey): boolean {
    const exists = this.store.has(key);
    logger.debug('Checking if key exists:', key, exists);
    return exists;
  }

  async openInEditor() {
    logger.info('Opening store in editor');
    await this.store.openInEditor();
  }
}
