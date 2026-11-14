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

export interface DesktopLocalDatabaseKeyQuery extends DesktopLocalDatabasePrefix {
  limit?: number;
  search?: string;
}

export interface DesktopLocalDatabaseKeyPage {
  keys: string[];
  total: number;
}

export interface DesktopLocalDatabaseKeyGroupQuery extends DesktopLocalDatabasePrefix {
  delimiter: string;
}

export interface DesktopLocalDatabaseKeyGroup {
  entryCount: number;
  name: string;
}

export interface DesktopLocalDatabaseSet extends DesktopLocalDatabaseKey {
  value: string;
}

export type DesktopLocalDatabaseBatchOperation =
  (DesktopLocalDatabaseKey & { type: 'delete' }) | (DesktopLocalDatabaseSet & { type: 'set' });
