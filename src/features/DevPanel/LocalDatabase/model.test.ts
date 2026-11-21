import { describe, expect, it } from 'vitest';

import type { LocalDatabaseEntry } from '@/libs/localDatabase';

import {
  createLocalDatabaseTableRows,
  filterLocalDatabaseFields,
  formatLocalDatabaseFieldValue,
  getLocalDatabaseColumns,
  getLocalDatabaseFields,
  parseReplicaStorageKey,
  replicaResourcePrefix,
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

  it('builds table rows and columns from keys alone', () => {
    const rows = createLocalDatabaseTableRows([...entries.map(({ key }) => key), 'not-a-replica']);

    expect(getLocalDatabaseColumns(rows).map(({ label }) => label)).toEqual([
      'key',
      'resource',
      'version',
      'scope',
      'query',
    ]);
    expect(rows[2].fields.map(({ label }) => label)).toEqual(['key']);
    expect(replicaResourcePrefix('topicList')).toBe('replica:topicList:');
    expect(entries[0].key.startsWith(replicaResourcePrefix('topicList'))).toBe(true);
  });

  it('expands a loaded timestamped envelope into detail fields after the key fields', () => {
    const fields = getLocalDatabaseFields(entries[1], parseReplicaStorageKey(entries[1].key));

    expect(fields.map(({ label }) => label)).toEqual([
      'key',
      'resource',
      'version',
      'scope',
      'query',
      'updatedAt',
      'id',
      'title',
    ]);
    expect(fields.find(({ label }) => label === 'updatedAt')?.value).toEqual(new Date(1000));
  });

  it('keeps data fields that collide with key columns under a data prefix', () => {
    const fields = getLocalDatabaseFields({
      key: 'plain',
      value: { data: { key: 'k', version: 'v2' }, updatedAt: 0, version: '7' },
    });

    expect(fields.map(({ label }) => label)).toEqual([
      'key',
      'version',
      'updatedAt',
      'data.key',
      'data.version',
    ]);
  });

  it('finds detail fields by name, type or nested persisted values', () => {
    const fields = getLocalDatabaseFields(entries[0], parseReplicaStorageKey(entries[0].key));

    expect(filterLocalDatabaseFields(fields, 'array').map(({ label }) => label)).toEqual(['items']);
    expect(filterLocalDatabaseFields(fields, 'storage').map(({ label }) => label)).toEqual([
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
