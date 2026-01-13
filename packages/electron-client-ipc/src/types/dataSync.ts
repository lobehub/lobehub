export type StorageMode = 'local' | 'cloud' | 'selfHost';
export enum StorageModeEnum {
  Cloud = 'cloud',
  SelfHost = 'selfHost',
}

/**
 * 远程服务器配置相关的事件
 */
export interface DataSyncConfig {
  active?: boolean;
  remoteServerUrl?: string;
  storageMode: StorageMode;
}
