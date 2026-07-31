import type { EntityTombstone } from '../entity';
import type { ClientDataEntityKind, ClientDataEntityRecord } from './entities';
import type { HomeIndexMap, HomeSnapshotMap } from './modules/home';

/** Application-wide registry. Extend these maps when another data module is migrated. */
export interface ClientDataIndexMap extends HomeIndexMap {}
export interface ClientDataSnapshotMap extends HomeSnapshotMap {}

export type ClientDataIndexKey = keyof ClientDataIndexMap;
export type ClientDataIndex = ClientDataIndexMap[ClientDataIndexKey];
export type ClientDataSnapshotKey = keyof ClientDataSnapshotMap;
export type ClientDataSnapshot = ClientDataSnapshotMap[ClientDataSnapshotKey];

export interface ClientDataCommit {
  entities?: ClientDataEntityRecord[];
  indexes?: ClientDataIndex[];
  snapshots?: ClientDataSnapshot[];
  tombstones?: EntityTombstone<ClientDataEntityKind>[];
}

export interface ClientDataRequestMarker {
  observedAt: number;
}
