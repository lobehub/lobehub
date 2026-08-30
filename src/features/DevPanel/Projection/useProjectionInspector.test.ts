import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEmptyProjectionScope } from '@/projection/core/initialState';
import { useProjectionStore } from '@/projection/store';

import { useProjectionInspector } from './useProjectionInspector';

const createScope = (title: string, includeAgent = false) => {
  const scope = createEmptyProjectionScope('ready');
  scope.records.topic['topic-1'] = {
    fragments: {
      display: { data: { title }, observedAt: 10, source: 'network' },
    },
    id: 'topic-1',
    kind: 'topic',
  };
  if (includeAgent) {
    scope.records.agent['agent-1'] = {
      fragments: {
        identity: { data: { title: 'Agent' }, observedAt: 10, source: 'network' },
      },
      id: 'agent-1',
      kind: 'agent',
    };
  }
  return scope;
};

const getSelectedTopicTitle = (
  result: ReturnType<typeof useProjectionInspector>,
): string | undefined => {
  const record = result.selectedRow?.projection?.record;
  return record?.kind === 'topic' ? record.fragments.display?.data.title : undefined;
};

describe('useProjectionInspector', () => {
  beforeEach(() => {
    useProjectionStore.setState({ scopes: {} });
  });

  afterEach(() => {
    useProjectionStore.setState({ scopes: {} });
  });

  it('reflects live table rows from every scope without a database refresh', () => {
    const { result } = renderHook(() => useProjectionInspector());

    act(() => {
      useProjectionStore.setState({
        scopes: {
          'user-1:personal': createScope('Initial'),
          'user-2:personal': createScope('Team'),
        },
      });
    });
    expect(result.current.selectedTable?.id).toBe('topic');
    expect(result.current.matchingRows).toHaveLength(2);
    expect(getSelectedTopicTitle(result.current)).toBe('Initial');

    act(() => {
      useProjectionStore.setState({
        scopes: {
          'user-1:personal': createScope('Edited'),
          'user-2:personal': createScope('Team'),
        },
      });
    });
    expect(getSelectedTopicTitle(result.current)).toBe('Edited');
  });

  it('switches the row set by table instead of by scope', () => {
    useProjectionStore.setState({ scopes: { 'user-1:personal': createScope('Topic', true) } });
    const { result } = renderHook(() => useProjectionInspector());

    expect(result.current.selectedTable?.id).toBe('agent');
    expect(result.current.matchingRows[0].projection?.record.kind).toBe('agent');

    act(() => result.current.selectTable('topic'));

    expect(result.current.selectedTable?.id).toBe('topic');
    expect(result.current.matchingRows[0].projection?.record.kind).toBe('topic');

    act(() => result.current.setTableSearch('home'));

    expect(result.current.visibleTables.map(({ id }) => id)).toEqual([
      'homeIndexes',
      'homeSnapshots',
    ]);
    expect(result.current.selectedTable?.id).toBe('topic');
  });
});
