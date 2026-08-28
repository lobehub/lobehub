import { describe, expect, it } from 'vitest';

import type { TodoItem } from '../../types';
import { computeTodoSummary, normalizeTodoItems } from './todoSummary';

const item = (status: TodoItem['status'], text: string): TodoItem => ({ status, text });

describe('normalizeTodoItems', () => {
  it('returns empty array when todos is undefined', () => {
    expect(normalizeTodoItems()).toEqual([]);
  });

  it('handles the new format ({ items })', () => {
    const items = [item('todo', 'a')];
    expect(normalizeTodoItems({ items, updatedAt: '2026-01-01' })).toEqual(items);
  });

  it('handles the legacy bare-array format', () => {
    const items = [item('todo', 'a')];
    expect(normalizeTodoItems(items)).toEqual(items);
  });
});

describe('computeTodoSummary', () => {
  it('returns idle for an empty list', () => {
    expect(computeTodoSummary([])).toEqual({ completed: 0, state: 'idle', total: 0 });
  });

  it('returns idle when nothing is completed or processing', () => {
    expect(computeTodoSummary([item('todo', 'a'), item('todo', 'b')])).toEqual({
      completed: 0,
      state: 'idle',
      total: 2,
    });
  });

  it('prefers the processing item as current step', () => {
    expect(
      computeTodoSummary([item('completed', 'a'), item('processing', 'b'), item('todo', 'c')]),
    ).toEqual({ completed: 1, detail: 'b', state: 'inProgress', total: 3 });
  });

  it('shows the last completed item when nothing is processing', () => {
    expect(
      computeTodoSummary([item('completed', 'a'), item('completed', 'b'), item('todo', 'c')]),
    ).toEqual({ completed: 2, detail: 'b', state: 'completedStep', total: 3 });
  });

  it('returns allDone when every item is completed', () => {
    expect(computeTodoSummary([item('completed', 'a'), item('completed', 'b')])).toEqual({
      completed: 2,
      state: 'allDone',
      total: 2,
    });
  });
});
