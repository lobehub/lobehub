export type StorageMode = 'cloud' | 'selfHost';
export enum StorageModeEnum {
  Cloud = 'cloud',
  SelfHost = 'selfHost',
}

/**
 * Remote server configuration related events
 */
export interface DataSyncConfig {
  active?: boolean;
  remoteServerUrl?: string;
  storageMode: StorageMode;
}
