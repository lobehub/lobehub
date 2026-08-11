export interface DesktopLocalDatabaseKey {
  collection: string;
  key: string;
}

export interface DesktopLocalDatabasePrefix {
  collection: string;
  prefix: string;
}

export interface DesktopLocalDatabaseEntry {
  key: string;
  value: string;
}

export interface DesktopLocalDatabaseCollectionInfo {
  entryCount: number;
  name: string;
}

export interface DesktopLocalDatabaseSet extends DesktopLocalDatabaseKey {
  value: string;
}

export type DesktopLocalDatabaseBatchOperation =
  (DesktopLocalDatabaseKey & { type: 'delete' }) | (DesktopLocalDatabaseSet & { type: 'set' });
