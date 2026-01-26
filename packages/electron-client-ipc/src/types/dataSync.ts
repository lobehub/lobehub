export type StorageMode = 'cloud' | 'selfHost';
export enum StorageModeEnum {
  Cloud = 'cloud',
  SelfHost = 'selfHost',
}

/**
 * Events related to remote server configuration
 */
export interface DataSyncConfig {
  active?: boolean;
  remoteServerUrl?: string;
  storageMode: StorageMode;
}
