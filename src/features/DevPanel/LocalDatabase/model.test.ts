import { describe, expect, it } from 'vitest';

import type { LocalDatabaseEntry } from '@/libs/localDatabase';

import {
  createLocalDatabaseTableRows,
  filterLocalDatabaseFields,
  filterLocalDatabaseRows,
  formatLocalDatabaseFieldValue,
  getLocalDatabaseColumns,
} from './model';

describe('Local Database table model', () => {
  const entries: LocalDatabaseEntry[] = [
    {
      key: 'user-a::agent::1',
      value: {
        schemaVersion: 1,
        value: { fragments: { profile: { title: 'Alpha' } }, id: '1', kind: 'agent' },
      },
    },
    {
      key: 'user-a::topic::2',
      value: {
        schemaVersion: 1,
        value: { fragments: { core: { title: 'Storage review' } }, id: '2', kind: 'topic' },
      },
    },
  ];

  it('expands persisted envelopes into stable table columns', () => {
    const rows = createLocalDatabaseTableRows(entries);

    expect(getLocalDatabaseColumns(rows).map(({ label }) => label)).toEqual([
      'key',
      'id',
      'kind',
      'schemaVersion',
      'fragments',
    ]);
    expect(rows[0].fields.find(({ label }) => label === 'id')?.value).toBe('1');
  });

  it('keeps priority columns ordered when fields first appear in later rows', () => {
    const rows = createLocalDatabaseTableRows([
      { key: 'first', value: { schemaVersion: 1, value: { title: 'First' } } },
      { key: 'second', value: { schemaVersion: 1, value: { id: '2', kind: 'topic' } } },
    ]);

    expect(getLocalDatabaseColumns(rows).map(({ label }) => label)).toEqual([
      'key',
      'id',
      'kind',
      'schemaVersion',
      'title',
    ]);
  });

  it('finds rows and details by field names or nested persisted values', () => {
    const rows = createLocalDatabaseTableRows(entries);

    expect(filterLocalDatabaseRows(rows, 'storage')).toEqual([rows[1]]);
    expect(filterLocalDatabaseRows(rows, 'agent')).toEqual([rows[0]]);
    expect(filterLocalDatabaseFields(rows[1].fields, 'object').map(({ label }) => label)).toEqual([
      'fragments',
    ]);
  });

  it('formats diagnostic values without failing on BigInt or circular references', () => {
    const value: { count: bigint; self?: unknown } = { count: 2n };
    value.self = value;

    expect(formatLocalDatabaseFieldValue(value)).toContain('"count": "2n"');
    expect(formatLocalDatabaseFieldValue(value)).toContain('"self": "[Circular]"');
  });
});
