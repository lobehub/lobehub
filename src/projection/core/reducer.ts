import type {
  ProjectionCommit,
  ProjectionFragment,
  ProjectionIndex,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@lobechat/types';
import { mergeProjectionRecord, shouldReplaceProjectionObservation } from '@lobechat/types';

import { createEmptyProjectionScope, type ProjectionScopeState } from './initialState';

export const applyProjectionCommit = (
  scopeState: ProjectionScopeState | undefined,
  commit: ProjectionCommit,
): ProjectionScopeState => {
  const current = scopeState ?? createEmptyProjectionScope();
  const next: ProjectionScopeState = {
    ...current,
    records: {
      agent: { ...current.records.agent },
      brief: { ...current.records.brief },
      chatGroup: { ...current.records.chatGroup },
      task: { ...current.records.task },
      topic: { ...current.records.topic },
    },
    indexes: { ...current.indexes },
    snapshots: { ...current.snapshots },
  };

  for (const incoming of commit.records ?? []) {
    const table = next.records[incoming.kind] as Record<string, ProjectionRecord>;
    table[incoming.id] = mergeProjectionRecord(table[incoming.id], incoming);
  }

  for (const tombstone of commit.tombstones ?? []) {
    const table = next.records[tombstone.kind] as Record<string, ProjectionRecord>;
    const record = table[tombstone.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= tombstone.observedAt) continue;

    const newerFragments = Object.fromEntries(
      Object.entries(
        (record?.fragments ?? {}) as Record<string, ProjectionFragment<unknown>>,
      ).filter(([, candidate]) => candidate.observedAt > tombstone.observedAt),
    );
    if (Object.keys(newerFragments).length > 0) {
      table[tombstone.id] = {
        fragments: newerFragments,
        id: tombstone.id,
        kind: tombstone.kind,
        tombstoneAt: tombstone.observedAt,
      } as ProjectionRecord;
      continue;
    }

    table[tombstone.id] = {
      fragments: {},
      id: tombstone.id,
      kind: tombstone.kind,
      tombstoneAt: tombstone.observedAt,
    } as ProjectionRecord;
  }

  for (const index of commit.indexes ?? []) {
    const existing = next.indexes[index.key] as ProjectionIndex | undefined;
    if (shouldReplaceProjectionObservation(existing, index)) {
      (next.indexes as Record<string, ProjectionIndex | undefined>)[index.key] = index;
    }
  }

  for (const snapshot of commit.snapshots ?? []) {
    const existing = next.snapshots[snapshot.key] as ProjectionSnapshot | undefined;
    if (shouldReplaceProjectionObservation(existing, snapshot)) {
      (next.snapshots as Record<string, ProjectionSnapshot | undefined>)[snapshot.key] = snapshot;
    }
  }

  return next;
};

/** Resolve the final merged values that must be written in one durable batch. */
export const materializeProjectionCommit = (
  scopeState: ProjectionScopeState,
  commit: ProjectionCommit,
): Required<Pick<ProjectionCommit, 'indexes' | 'records' | 'snapshots'>> => {
  const recordKeys = new Set<string>();
  for (const record of commit.records ?? []) recordKeys.add(`${record.kind}:${record.id}`);
  for (const tombstone of commit.tombstones ?? []) {
    recordKeys.add(`${tombstone.kind}:${tombstone.id}`);
  }

  const records: ProjectionRecord[] = [];
  for (const composite of recordKeys) {
    const separator = composite.indexOf(':');
    const kind = composite.slice(0, separator) as ProjectionRecord['kind'];
    const id = composite.slice(separator + 1);
    const record = (scopeState.records[kind] as Record<string, ProjectionRecord>)[id];
    if (record) records.push(record);
  }

  const indexKeys = new Set((commit.indexes ?? []).map((index) => index.key));
  const indexes = Array.from(indexKeys)
    .map((key) => scopeState.indexes[key])
    .filter((index): index is ProjectionIndex => Boolean(index))
    .map((index) => {
      const { persistRefLimit, refs } = index as { persistRefLimit?: number; refs?: unknown[] };
      if (!persistRefLimit || !Array.isArray(refs) || refs.length <= persistRefLimit) return index;
      return { ...index, refs: refs.slice(0, persistRefLimit) } as ProjectionIndex;
    });

  const snapshotKeys = new Set((commit.snapshots ?? []).map((snapshot) => snapshot.key));
  const snapshots = Array.from(snapshotKeys)
    .map((key) => scopeState.snapshots[key])
    .filter((snapshot): snapshot is ProjectionSnapshot => Boolean(snapshot));

  return { indexes, records, snapshots };
};
