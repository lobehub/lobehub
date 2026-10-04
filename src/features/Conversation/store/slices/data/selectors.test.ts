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

describe('getRowLatestMessageWithoutTools', () => {
  it('resolves a steered row to the final answer of its last turn', () => {
    const state = stateWith([
      { content: 'first draft', id: 'a1', role: 'assistant' },
      { content: 'shorter please', id: 's1', metadata: { steer: true }, role: 'user' },
      {
        children: [
          { content: '', id: 'b1', tools: [{ id: 't1' }] },
          { content: 'final answer', id: 'b2' },
        ],
        id: 'g2',
        role: 'assistantGroup',
      },
    ]);

    expect(dataSelectors.getRowLatestMessageWithoutTools('a1')(state)).toMatchObject({
      content: 'final answer',
      id: 'b2',
    });
  });

  it('uses a plain assistant tail as the row answer', () => {
    const state = stateWith([
      { children: [{ content: 'first', id: 'b1' }], id: 'g1', role: 'assistantGroup' },
      { content: 'go on', id: 's1', metadata: { steer: true }, role: 'user' },
      { content: 'tail answer', id: 'a2', role: 'assistant' },
    ]);

    expect(dataSelectors.getRowLatestMessageWithoutTools('g1')(state)).toMatchObject({
      content: 'tail answer',
      id: 'a2',
    });
  });

  it('keeps the group answer for an unsteered row', () => {
    const state = stateWith([
      { children: [{ content: 'only answer', id: 'b1' }], id: 'g1', role: 'assistantGroup' },
    ]);

    expect(dataSelectors.getRowLatestMessageWithoutTools('g1')(state)).toMatchObject({
      id: 'b1',
    });
  });
});

describe('isRefreshingAt', () => {
  const messages = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' },
    { id: 'g2', role: 'assistantGroup' },
    { id: 'u3', role: 'user' },
  ];
  const refreshing = (isRefreshingMessages: boolean) =>
    ({ displayMessages: messages, isRefreshingMessages }) as unknown as State;

  it('marks only the latest assistant row while refreshing', () => {
    expect(dataSelectors.isRefreshingAt('g2')(refreshing(true))).toBe(true);
    expect(dataSelectors.isRefreshingAt('a1')(refreshing(true))).toBe(false);
    expect(dataSelectors.isRefreshingAt('u3')(refreshing(true))).toBe(false);
  });

  it('marks the host row when the latest reply is a folded steer continuation', () => {
    const state = {
      displayMessages: [
        { content: 'first draft', id: 'a1', role: 'assistant' },
        { content: 'shorter please', id: 's1', metadata: { steer: true }, role: 'user' },
        { children: [{ content: 'final answer', id: 'b1' }], id: 'g2', role: 'assistantGroup' },
      ],
      isRefreshingMessages: true,
    } as unknown as State;

    expect(dataSelectors.isRefreshingAt('a1')(state)).toBe(true);
    expect(dataSelectors.isRefreshingAt('g2')(state)).toBe(false);
  });

  it('marks nothing once the fetch settled', () => {
    expect(dataSelectors.isRefreshingAt('g2')(refreshing(false))).toBe(false);
  });
});
