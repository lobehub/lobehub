/**
 * @vitest-environment happy-dom
 */
import type { HomeTasksIndex, TaskEntityRecord, TaskStatus } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyClientDataScope } from '../../core/initialState';
import { applyClientDataCommit } from '../../core/reducer';
import { useClientDataStore } from '../../store';
import { useHomeTask, useHomeTaskIds } from './viewHooks';

const SCOPE = 'user-1:personal';
const networkObservation = { observedAt: 100, source: 'network' as const };

vi.mock('@/libs/swr/useCacheScope', () => ({
  isAnonymousScope: (scope: string) => scope.startsWith('anon:'),
  isScopeTrusted: () => false,
  useCacheScope: () => 'user-1:personal',
}));

const task = (id: string): TaskEntityRecord => ({
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
  const record: TaskEntityRecord = {
    fragments: {
      lifecycle: { data: { status }, observedAt, source: 'mutation' },
    },
    id,
    kind: 'task',
  };

  useClientDataStore.setState((state) => ({
    scopes: {
      ...state.scopes,
      [SCOPE]: applyClientDataCommit(state.scopes[SCOPE], { entities: [record] }),
    },
  }));
};

describe('Home entity view hooks', () => {
  beforeEach(() => {
    const scope = applyClientDataCommit(createEmptyClientDataScope('ready'), {
      entities: [task('task-1'), task('task-2')],
      indexes: [tasksIndex],
    });
    useClientDataStore.setState({ scopes: { [SCOPE]: scope } });
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
