import { describe, expect, it } from 'vitest';

import type { State } from '../../initialState';
import { dataSelectors } from './selectors';

const stateWith = (displayMessages: unknown[]): State => ({ displayMessages }) as unknown as State;

describe('taskCallbackTaskIds', () => {
  it('collects task ids from landed taskCallback messages only', () => {
    const state = stateWith([
      { id: 'm1', role: 'user' },
      {
        id: 'm2',
        metadata: { taskCallback: { identifier: 'T-262', reason: 'done', taskId: 'task-a' } },
        role: 'taskCallback',
      },
      // Same metadata on a non-callback role must not count.
      {
        id: 'm3',
        metadata: { taskCallback: { identifier: 'T-1', reason: 'done', taskId: 'task-x' } },
        role: 'assistant',
      },
      {
        id: 'm4',
        metadata: { taskCallback: { identifier: 'T-263', reason: 'error', taskId: 'task-b' } },
        role: 'taskCallback',
      },
    ]);

    expect(dataSelectors.taskCallbackTaskIds(state)).toEqual(['task-a', 'task-b']);
  });

  it('skips callback messages without a task pointer', () => {
    const state = stateWith([
      { id: 'm1', role: 'taskCallback' },
      { id: 'm2', metadata: {}, role: 'taskCallback' },
    ]);

    expect(dataSelectors.taskCallbackTaskIds(state)).toEqual([]);
  });

  it('returns an empty list when no callbacks landed', () => {
    expect(dataSelectors.taskCallbackTaskIds(stateWith([{ id: 'm1', role: 'user' }]))).toEqual([]);
  });
});
