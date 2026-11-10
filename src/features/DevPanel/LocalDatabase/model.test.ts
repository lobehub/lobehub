import { describe, expect, it } from 'vitest';

import type { LocalDatabaseEntry } from '@/libs/localDatabase';

import {
  createLocalDatabaseTableRows,
  filterLocalDatabaseFields,
  filterLocalDatabaseRows,
  filterRowsByResource,
  formatLocalDatabaseFieldValue,
  getLocalDatabaseColumns,
  getReplicaResourceGroups,
  parseReplicaStorageKey,
} from './model';

const replicaKey = (resource: string, scope: string, queryKey: string, version = 1) =>
  `replica:${resource}:v${version}:${encodeURIComponent(scope)}:${encodeURIComponent(queryKey)}`;

describe('Local Database table model', () => {
  const entries: LocalDatabaseEntry[] = [
    {
      key: replicaKey('topicList', 'user-a:ws-1', 'agent_1?{"sortBy":"updatedAt"}'),
      value: { data: { items: [{ id: 't1', title: 'Storage review' }], total: 1 }, updatedAt: 0 },
    },
    {
      key: replicaKey('agentDetail', 'user-a:ws-1', 'agent_1', 3),
      value: { data: { id: 'agent_1', title: 'Alpha' }, updatedAt: 1000 },
    },
  ];

  it('decodes replica storage keys into resource, version, scope and query', () => {
    expect(parseReplicaStorageKey(entries[0].key)).toEqual({
      query: 'agent_1?{"sortBy":"updatedAt"}',
      resource: 'topicList',
      scope: 'user-a:ws-1',
      version: 1,
    });
    expect(parseReplicaStorageKey(replicaKey('a:b', 's', '__replica:index'))).toEqual({
      query: '__replica:index',
      resource: 'a:b',
      scope: 's',
      version: 1,
    });
    expect(parseReplicaStorageKey('swr:message:list')).toBeUndefined();
  });

  it('expands timestamped envelopes into replica columns before the data fields', () => {
    const rows = createLocalDatabaseTableRows(entries);

    expect(getLocalDatabaseColumns(rows).map(({ label }) => label)).toEqual([
      'key',
      'resource',
      'version',
      'scope',
      'query',
      'updatedAt',
      'id',
      'items',
      'total',
      'title',
    ]);
    expect(rows[1].fields.find(({ label }) => label === 'updatedAt')?.value).toEqual(
      new Date(1000),
    );
  });

  it('keeps data fields that collide with key columns under a data prefix', () => {
    const [row] = createLocalDatabaseTableRows([
      { key: 'plain', value: { data: { key: 'k', version: 'v2' }, updatedAt: 0, version: '7' } },
    ]);

    expect(row.fields.map(({ label }) => label)).toEqual([
      'key',
      'version',
      'updatedAt',
      'data.key',
      'data.version',
    ]);
  });

  it('groups replica rows by resource and filters the table to one resource', () => {
    const rows = createLocalDatabaseTableRows([
      ...entries,
      { key: 'not-a-replica', value: 1 },
      { key: replicaKey('topicList', 'user-b', 'agent_2'), value: { data: null, updatedAt: 0 } },
    ]);

    expect(getReplicaResourceGroups(rows)).toEqual([
      { entryCount: 1, name: 'agentDetail' },
      { entryCount: 2, name: 'topicList' },
    ]);
    expect(filterRowsByResource(rows, 'topicList')).toHaveLength(2);
    expect(filterRowsByResource(rows, null)).toHaveLength(4);
  });

  it('finds rows and details by field names or nested persisted values', () => {
    const rows = createLocalDatabaseTableRows(entries);

    expect(filterLocalDatabaseRows(rows, 'storage')).toEqual([rows[0]]);
    expect(filterLocalDatabaseRows(rows, 'alpha')).toEqual([rows[1]]);
    expect(filterLocalDatabaseFields(rows[0].fields, 'array').map(({ label }) => label)).toEqual([
      'items',
    ]);
  });

  it('formats diagnostic values without failing on BigInt or circular references', () => {
    const value: { count: bigint; self?: unknown } = { count: 2n };
    value.self = value;

    expect(formatLocalDatabaseFieldValue(value)).toContain('"count": "2n"');
    expect(formatLocalDatabaseFieldValue(value)).toContain('"self": "[Circular]"');
  });
});
