/**
 * @vitest-environment happy-dom
 */
import type { HomeTaskRecord, HomeTasksIndex, TaskStatus } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyEntityScope } from './initialState';
import { applyHomeDataCommit } from './reducer';
import { useEntityStore } from './store';
import { useHomeTask, useHomeTaskIds } from './viewHooks';

const SCOPE = 'user-1:personal';
const networkObservation = { observedAt: 100, source: 'network' as const };

vi.mock('@/libs/swr/useCacheScope', () => ({
  isAnonymousScope: (scope: string) => scope.startsWith('anon:'),
  isScopeTrusted: () => false,
  useCacheScope: () => 'user-1:personal',
}));

const task = (id: string): HomeTaskRecord => ({
  fragments: {
    description: { data: { description: `${id} description` }, ...networkObservation },
    display: { data: { name: `${id} name` }, ...networkObservation },
    identity: { data: { identifier: id.toUpperCase() }, ...networkObservation },
    lifecycle: { data: { status: 'running' }, ...networkObservation },
  },
  id,
  kind: 'task',
});

const tasksIndex: HomeTasksIndex = {
  key: 'home.tasks',
  observedAt: 100,
  refs: [
    { id: 'task-1', kind: 'task' },
    { id: 'task-2', kind: 'task' },
  ],
  source: 'network',
  total: 2,
};

const updateTaskStatus = (id: string, status: TaskStatus, observedAt: number) => {
  const record: HomeTaskRecord = {
    fragments: {
      lifecycle: { data: { status }, observedAt, source: 'mutation' },
    },
    id,
    kind: 'task',
  };

  useEntityStore.setState((state) => ({
    scopes: {
      ...state.scopes,
      [SCOPE]: applyHomeDataCommit(state.scopes[SCOPE], { entities: [record] }),
    },
  }));
};

describe('Home entity view hooks', () => {
  beforeEach(() => {
    const scope = applyHomeDataCommit(createEmptyEntityScope('ready'), {
      entities: [task('task-1'), task('task-2')],
      indexes: [tasksIndex],
    });
    useEntityStore.setState({ scopes: { [SCOPE]: scope } });
  });

  it('keeps the Index subscriber stable while only the changed entity row rerenders', () => {
    let listRenders = 0;
    let firstRowRenders = 0;
    let secondRowRenders = 0;

    const list = renderHook(() => {
      listRenders += 1;
      return useHomeTaskIds();
    });
    const firstRow = renderHook(() => {
      firstRowRenders += 1;
      return useHomeTask('task-1');
    });
    renderHook(() => {
      secondRowRenders += 1;
      return useHomeTask('task-2');
    });

    const initialIds = list.result.current;
    const listRendersBefore = listRenders;
    const firstRendersBefore = firstRowRenders;
    const secondRendersBefore = secondRowRenders;

    act(() => updateTaskStatus('task-1', 'completed', 200));

    expect(list.result.current).toBe(initialIds);
    expect(listRenders).toBe(listRendersBefore);
    expect(firstRowRenders).toBeGreaterThan(firstRendersBefore);
    expect(secondRowRenders).toBe(secondRendersBefore);
    expect(firstRow.result.current?.status).toBe('completed');
  });
});
