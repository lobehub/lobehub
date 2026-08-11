/**
 * @vitest-environment happy-dom
 */
import type { HomeTasksIndex, TaskProjection, TaskStatus } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyProjectionScope } from '../../core/initialState';
import { applyProjectionCommit } from '../../core/reducer';
import { useProjectionStore } from '../../store';
import { useHomeTask, useHomeTaskIds } from './viewHooks';

const SCOPE = 'user-1:personal';
const networkObservation = { observedAt: 100, source: 'network' as const };

vi.mock('@/libs/swr/useCacheScope', () => ({
  isAnonymousScope: (scope: string) => scope.startsWith('anon:'),
  isScopeTrusted: () => false,
  useCacheScope: () => 'user-1:personal',
}));

const task = (id: string): TaskProjection => ({
  fragments: {
    assignment: {
      data: { assigneeAgentId: 'agent-1', visibility: 'public', workspaceId: null },
      ...networkObservation,
    },
    description: { data: { description: `${id} description` }, ...networkObservation },
    display: { data: { name: `${id} name` }, ...networkObservation },
    identity: { data: { identifier: id.toUpperCase() }, ...networkObservation },
    lifecycle: { data: { status: 'running' }, ...networkObservation },
    row: {
      data: {
        accessedAt: new Date('2026-08-02T00:00:00.000Z'),
        assigneeUserId: null,
        automationMode: null,
        completedAt: null,
        config: null,
        context: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        createdByAgentId: null,
        createdByUserId: 'user-1',
        currentTopicId: null,
        editorData: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        instruction: `${id} instruction`,
        lastHeartbeatAt: null,
        maxTopics: null,
        parentTaskId: null,
        priority: null,
        projectId: null,
        schedulePattern: null,
        scheduleTimezone: null,
        seq: 1,
        sortOrder: null,
        startedAt: null,
        totalTopics: 0,
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      },
      ...networkObservation,
    },
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
  const record: TaskProjection = {
    fragments: {
      lifecycle: { data: { status }, observedAt, source: 'mutation' },
    },
    id,
    kind: 'task',
  };

  useProjectionStore.setState((state) => ({
    scopes: {
      ...state.scopes,
      [SCOPE]: applyProjectionCommit(state.scopes[SCOPE], { records: [record] }),
    },
  }));
};

describe('Home projection view hooks', () => {
  beforeEach(() => {
    const scope = applyProjectionCommit(createEmptyProjectionScope('ready'), {
      records: [task('task-1'), task('task-2')],
      indexes: [tasksIndex],
    });
    useProjectionStore.setState({ scopes: { [SCOPE]: scope } });
  });

  it('keeps the Index subscriber stable while only the changed Projection row rerenders', () => {
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
