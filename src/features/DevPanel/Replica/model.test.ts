import type { ReplicaState } from '@lobechat/replica';
import { describe, expect, it } from 'vitest';

import type { ReplicaDevtoolsEntry } from '@/libs/replica/devtools';

import {
  createReplicaEntryRows,
  describeReplicaValue,
  filterReplicaEntryRows,
  parseReplicaDraft,
  serializeReplicaDraft,
  summarizeReplicaResource,
} from './model';

const createEntry = (
  state: ReplicaState<unknown>,
  view: Record<string, unknown>,
  paged = false,
): ReplicaDevtoolsEntry =>
  ({
    keys: () => [...new Set([...Object.keys(state.entries), ...Object.keys(view)])],
    read: (key: string) => view[key],
    remove: () => true,
    resource: {
      name: 'topicList',
      namespace: 'replica:topicList:v2',
      paging: paged ? {} : undefined,
      persisted: true,
      version: 2,
    },
    revalidate: async () => undefined,
    state: () => state,
    update: () => undefined,
  }) as unknown as ReplicaDevtoolsEntry;

const state: ReplicaState<unknown> = {
  entries: {
    agent_1: {
      base: { items: [], total: 0 },
      pending: [{ apply: (data) => data, id: 1 }],
      query: '{"sortBy":"updatedAt"}',
      source: 'server',
      updatedAt: 2000,
    },
    agent_2: { pending: [], source: 'storage', updatedAt: 1000 },
  },
  scope: 'user-1:personal',
};

describe('Replica inspector model', () => {
  it('summarizes a resource from its bookkeeping and loaded view keys', () => {
    const entry = createEntry(state, { agent_1: {}, agent_2: {}, seeded: {} }, true);

    expect(summarizeReplicaResource(entry)).toEqual({
      entryCount: 3,
      name: 'topicList',
      namespace: 'replica:topicList:v2',
      paged: true,
      pendingCount: 1,
      persisted: true,
      scope: 'user-1:personal',
      version: 2,
    });
  });

  it('lists entries newest first, including view keys the engine has no meta for', () => {
    const rows = createReplicaEntryRows(createEntry(state, { agent_1: 1, seeded: 2 }));

    expect(rows.map(({ key, pending, source }) => [key, source, pending])).toEqual([
      ['agent_1', 'server', 1],
      ['agent_2', 'storage', 0],
      ['seeded', '—', 0],
    ]);
    expect(rows[0].hasBase).toBe(true);
    expect(rows[0].updatedAt).toEqual(new Date(2000));
    expect(filterReplicaEntryRows(rows, 'sortby').map(({ key }) => key)).toEqual(['agent_1']);
    expect(filterReplicaEntryRows(rows, 'storage').map(({ key }) => key)).toEqual(['agent_2']);
  });

  it('describes values compactly for the table', () => {
    expect(describeReplicaValue({ items: [1, 2], total: 2 })).toBe('page · 2 items');
    expect(describeReplicaValue({ id: 'a', title: 'b' })).toBe('object{2}');
    expect(describeReplicaValue([1])).toBe('array[1]');
    expect(describeReplicaValue(undefined)).toBe('—');
  });

  it('round-trips dates through an edit draft', () => {
    const value = { createdAt: new Date('2026-10-16T00:00:00.000Z'), tags: ['a'], title: 'T' };
    const draft = serializeReplicaDraft(value);

    expect(draft).toContain('"$date": "2026-10-16T00:00:00.000Z"');
    expect(parseReplicaDraft(draft)).toEqual(value);
    expect(parseReplicaDraft('{"$date":"x","other":1}')).toEqual({ $date: 'x', other: 1 });
  });
});
