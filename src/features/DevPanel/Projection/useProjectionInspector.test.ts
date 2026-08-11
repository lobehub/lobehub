import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEmptyProjectionScope } from '@/projection/core/initialState';
import { useProjectionStore } from '@/projection/store';

import { useProjectionInspector } from './useProjectionInspector';

const createScope = (title: string) => {
  const scope = createEmptyProjectionScope('ready');
  scope.records.topic['topic-1'] = {
    fragments: {
      display: { data: { title }, observedAt: 10, source: 'network' },
    },
    id: 'topic-1',
    kind: 'topic',
  };
  return scope;
};

const getSelectedTopicTitle = (
  result: ReturnType<typeof useProjectionInspector>,
): string | undefined => {
  const record = result.selectedRow?.projection.record;
  return record?.kind === 'topic' ? record.fragments.display?.data.title : undefined;
};

describe('useProjectionInspector', () => {
  beforeEach(() => {
    useProjectionStore.setState({ scopes: {} });
  });

  afterEach(() => {
    useProjectionStore.setState({ scopes: {} });
  });

  it('reflects live Projection Store changes without a database refresh', () => {
    const { result } = renderHook(() => useProjectionInspector());

    act(() => {
      useProjectionStore.setState({ scopes: { 'user-1:personal': createScope('Initial') } });
    });
    expect(result.current.selectedScope).toBe('user-1:personal');
    expect(getSelectedTopicTitle(result.current)).toBe('Initial');

    act(() => {
      useProjectionStore.setState({ scopes: { 'user-1:personal': createScope('Edited') } });
    });
    expect(getSelectedTopicTitle(result.current)).toBe('Edited');
  });
});
