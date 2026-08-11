import { describe, expect, it } from 'vitest';

import { createEmptyProjectionScope } from '@/projection/core/initialState';

import {
  createProjectionScopeRows,
  createProjectionTableRows,
  filterProjectionScopeRows,
  filterProjectionTableRows,
} from './model';

const createScope = () => {
  const scope = createEmptyProjectionScope('ready');
  scope.records.topic['topic-1'] = {
    fragments: {
      display: { data: { title: 'Inbox review' }, observedAt: 10, source: 'network' },
      status: { data: { status: 'active' }, observedAt: 20, source: 'realtime' },
    },
    id: 'topic-1',
    kind: 'topic',
  };
  return scope;
};

describe('Projection DevTool model', () => {
  it('summarizes scopes and their live record counts', () => {
    const rows = createProjectionScopeRows({
      'user-1:personal': createScope(),
      'user-2:personal': createEmptyProjectionScope('hydrating'),
    });

    expect(rows).toEqual([
      { hydrationStatus: 'ready', recordCount: 1, scope: 'user-1:personal' },
      { hydrationStatus: 'hydrating', recordCount: 0, scope: 'user-2:personal' },
    ]);
    expect(filterProjectionScopeRows(rows, 'HYDRATING')).toEqual([rows[1]]);
  });

  it('materializes searchable rows from the merged Projection Store', () => {
    const rows = createProjectionTableRows('user-1:personal', createScope());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fragmentNames: ['display', 'status'],
      latestObservedAt: 20,
      projection: {
        entryKey: 'user-1%3Apersonal::topic::topic-1',
        scope: 'user-1:personal',
      },
      sources: ['network', 'realtime'],
    });
    expect(filterProjectionTableRows(rows, 'Inbox review')).toEqual(rows);
    expect(filterProjectionTableRows(rows, 'missing')).toEqual([]);
  });
});
