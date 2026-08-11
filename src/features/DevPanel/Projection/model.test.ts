import { describe, expect, it } from 'vitest';

import { createEmptyProjectionScope } from '@/projection/core/initialState';

import {
  createProjectionTableCell,
  createProjectionTableColumns,
  createProjectionTableRows,
  createProjectionTableSummaries,
  filterProjectionTableRows,
  filterProjectionTableSummaries,
} from './model';

const createScope = (title: string, includeHomeIndex = false) => {
  const scope = createEmptyProjectionScope('ready');
  scope.records.topic['topic-1'] = {
    fragments: {
      display: { data: { title }, observedAt: 10, source: 'network' },
      status: { data: { status: 'active' }, observedAt: 20, source: 'realtime' },
    },
    id: 'topic-1',
    kind: 'topic',
  };
  if (includeHomeIndex) {
    scope.indexes['home.tasks'] = {
      key: 'home.tasks',
      observedAt: 30,
      refs: [{ id: 'task-1', kind: 'task' }],
      source: 'network',
      total: 1,
    };
  }
  return scope;
};

describe('Projection DevTool model', () => {
  it('summarizes logical tables across every loaded scope', () => {
    const tables = createProjectionTableSummaries({
      'user-1:personal': createScope('First', true),
      'user-2:personal': createScope('Second'),
    });

    expect(tables.find(({ id }) => id === 'topic')?.rowCount).toBe(2);
    expect(tables.find(({ id }) => id === 'homeIndexes')?.rowCount).toBe(1);
    expect(filterProjectionTableSummaries(tables, 'chat group').map(({ id }) => id)).toEqual([
      'chatGroup',
    ]);
  });

  it('stacks the selected entity table across scopes and keeps scope searchable', () => {
    const rows = createProjectionTableRows(
      {
        'user-1:personal': createScope('Inbox review'),
        'user-2:personal': createScope('Team review'),
      },
      'topic',
    );

    expect(rows.map(({ scope }) => scope)).toEqual(['user-1:personal', 'user-2:personal']);
    expect(rows[0]).toMatchObject({
      fieldNames: ['display', 'status'],
      identity: 'topic-1',
      latestObservedAt: 20,
      projection: {
        entryKey: 'user-1%3Apersonal::topic::topic-1',
        scope: 'user-1:personal',
      },
      sources: ['network', 'realtime'],
    });
    expect(filterProjectionTableRows(rows, 'user-2:personal')).toEqual([rows[1]]);
    expect(filterProjectionTableRows(rows, 'Inbox review')).toEqual([rows[0]]);
  });

  it('materializes index tables as editable Projection rows', () => {
    const rows = createProjectionTableRows(
      { 'user-1:personal': createScope('Inbox review', true) },
      'homeIndexes',
    );

    expect(rows).toMatchObject([
      {
        fieldNames: ['refs', 'total'],
        identity: 'home.tasks',
        latestObservedAt: 30,
        scope: 'user-1:personal',
        sources: ['network'],
      },
    ]);
    expect(rows[0].projection).toBeUndefined();
  });

  it('expands data fields into columns and keeps identity metadata immutable', () => {
    const rows = createProjectionTableRows(
      { 'user-1:personal': createScope('Inbox review', true) },
      'topic',
    );
    const table = createProjectionTableSummaries({
      'user-1:personal': createScope('Inbox review', true),
    }).find(({ id }) => id === 'topic');
    const columns = createProjectionTableColumns(rows, table ?? null);

    expect(columns.map(({ label }) => label)).toEqual([
      'scope',
      'id',
      'display',
      'status',
      'source',
      'observed_at',
    ]);
    expect(createProjectionTableCell(rows[0], columns[0]).editTarget).toBeUndefined();
    expect(createProjectionTableCell(rows[0], columns[1]).editTarget).toBeUndefined();
    expect(createProjectionTableCell(rows[0], columns[2])).toMatchObject({
      displayValue: '{"title":"Inbox review"}',
      editTarget: { fragmentName: 'display', type: 'fragment' },
    });
    const sourceColumn = columns.at(-2)!;
    const observedAtColumn = columns.at(-1)!;
    expect(createProjectionTableCell(rows[0], sourceColumn).editTarget).toBeUndefined();
    expect(createProjectionTableCell(rows[0], observedAtColumn).editTarget).toBeUndefined();
  });

  it('creates field edit targets for index data without exposing key or observation metadata', () => {
    const scopes = { 'user-1:personal': createScope('Inbox review', true) };
    const rows = createProjectionTableRows(scopes, 'homeIndexes');
    const table = createProjectionTableSummaries(scopes).find(({ id }) => id === 'homeIndexes');
    const columns = createProjectionTableColumns(rows, table ?? null);
    const totalColumn = columns.find(({ label }) => label === 'total');

    expect(totalColumn).toBeDefined();
    expect(createProjectionTableCell(rows[0], totalColumn!)).toMatchObject({
      displayValue: '1',
      editTarget: {
        fieldName: 'total',
        key: 'home.tasks',
        scope: 'user-1:personal',
        type: 'index',
      },
    });
    expect(columns.filter(({ label }) => label === 'key')).toEqual([
      expect.objectContaining({ id: 'identity', kind: 'identity' }),
    ]);
  });
});
