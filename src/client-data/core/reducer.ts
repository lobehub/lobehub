import type {
  ClientDataCommit,
  ClientDataEntityRecord,
  ClientDataIndex,
  ClientDataSnapshot,
  EntityFragment,
  EntitySource,
} from '@lobechat/types';

import { type ClientDataScopeState, createEmptyClientDataScope } from './initialState';

const SOURCE_PRIORITY: Record<EntitySource, number> = {
  mutation: 3,
  network: 1,
  realtime: 2,
};

interface TimestampedValue {
  observedAt: number;
  source: EntitySource;
}

const shouldReplace = (
  current: TimestampedValue | undefined,
  incoming: TimestampedValue,
): boolean =>
  !current ||
  incoming.observedAt > current.observedAt ||
  (incoming.observedAt === current.observedAt &&
    SOURCE_PRIORITY[incoming.source] >= SOURCE_PRIORITY[current.source]);

const mergeEntityRecord = (
  current: ClientDataEntityRecord | undefined,
  incoming: ClientDataEntityRecord,
): ClientDataEntityRecord => {
  const tombstoneBarrier =
    Math.max(current?.tombstoneAt ?? 0, incoming.tombstoneAt ?? 0) || undefined;
  const fragments = Object.fromEntries(
    Object.entries((current?.fragments ?? {}) as Record<string, EntityFragment<unknown>>).filter(
      ([, candidate]) => !tombstoneBarrier || candidate.observedAt > tombstoneBarrier,
    ),
  );

  for (const [name, candidate] of Object.entries(
    incoming.fragments as Record<string, EntityFragment<unknown>>,
  )) {
    if (tombstoneBarrier && candidate.observedAt <= tombstoneBarrier) continue;
    if (!shouldReplace(fragments[name], candidate)) continue;

    fragments[name] = candidate;
  }

  const tombstoneAt =
    tombstoneBarrier && Object.keys(fragments).length === 0 ? tombstoneBarrier : undefined;

  return {
    fragments,
    id: incoming.id,
    kind: incoming.kind,
    ...(tombstoneAt ? { tombstoneAt } : {}),
  } as ClientDataEntityRecord;
};

export const applyClientDataCommit = (
  scopeState: ClientDataScopeState | undefined,
  commit: ClientDataCommit,
): ClientDataScopeState => {
  const current = scopeState ?? createEmptyClientDataScope();
  const next: ClientDataScopeState = {
    ...current,
    entities: {
      agent: { ...current.entities.agent },
      brief: { ...current.entities.brief },
      chatGroup: { ...current.entities.chatGroup },
      task: { ...current.entities.task },
      topic: { ...current.entities.topic },
    },
    indexes: { ...current.indexes },
    snapshots: { ...current.snapshots },
  };

  for (const incoming of commit.entities ?? []) {
    const table = next.entities[incoming.kind] as Record<string, ClientDataEntityRecord>;
    table[incoming.id] = mergeEntityRecord(table[incoming.id], incoming);
  }

  for (const tombstone of commit.tombstones ?? []) {
    const table = next.entities[tombstone.kind] as Record<string, ClientDataEntityRecord>;
    const record = table[tombstone.id];
    if (record?.tombstoneAt && record.tombstoneAt >= tombstone.observedAt) continue;

    const newerFragments = Object.fromEntries(
      Object.entries((record?.fragments ?? {}) as Record<string, EntityFragment<unknown>>).filter(
        ([, candidate]) => candidate.observedAt > tombstone.observedAt,
      ),
    );
    if (Object.keys(newerFragments).length > 0) {
      table[tombstone.id] = {
        fragments: newerFragments,
        id: tombstone.id,
        kind: tombstone.kind,
      } as ClientDataEntityRecord;
      continue;
    }

    table[tombstone.id] = {
      fragments: {},
      id: tombstone.id,
      kind: tombstone.kind,
      tombstoneAt: tombstone.observedAt,
    } as ClientDataEntityRecord;
  }

  for (const index of commit.indexes ?? []) {
    const existing = next.indexes[index.key] as ClientDataIndex | undefined;
    if (shouldReplace(existing, index)) {
      (next.indexes as Record<string, ClientDataIndex | undefined>)[index.key] = index;
    }
  }

  for (const snapshot of commit.snapshots ?? []) {
    const existing = next.snapshots[snapshot.key] as ClientDataSnapshot | undefined;
    if (shouldReplace(existing, snapshot)) {
      (next.snapshots as Record<string, ClientDataSnapshot | undefined>)[snapshot.key] = snapshot;
    }
  }

  return next;
};

/** Resolve the final merged values that must be written in one durable batch. */
export const materializeDurableCommit = (
  scopeState: ClientDataScopeState,
  commit: ClientDataCommit,
): Required<Pick<ClientDataCommit, 'entities' | 'indexes' | 'snapshots'>> => {
  const entityKeys = new Set<string>();
  for (const entity of commit.entities ?? []) entityKeys.add(`${entity.kind}:${entity.id}`);
  for (const tombstone of commit.tombstones ?? []) {
    entityKeys.add(`${tombstone.kind}:${tombstone.id}`);
  }

  const entities: ClientDataEntityRecord[] = [];
  for (const composite of entityKeys) {
    const separator = composite.indexOf(':');
    const kind = composite.slice(0, separator) as ClientDataEntityRecord['kind'];
    const id = composite.slice(separator + 1);
    const record = (scopeState.entities[kind] as Record<string, ClientDataEntityRecord>)[id];
    if (record) entities.push(record);
  }

  const indexKeys = new Set((commit.indexes ?? []).map((index) => index.key));
  const indexes = Array.from(indexKeys)
    .map((key) => scopeState.indexes[key])
    .filter((index): index is ClientDataIndex => Boolean(index));

  const snapshotKeys = new Set((commit.snapshots ?? []).map((snapshot) => snapshot.key));
  const snapshots = Array.from(snapshotKeys)
    .map((key) => scopeState.snapshots[key])
    .filter((snapshot): snapshot is ClientDataSnapshot => Boolean(snapshot));

  return { entities, indexes, snapshots };
};
