import { describe, expect, it } from 'vitest';

import type { ClaudeCodeTodoItem } from '../types';
import { computeTodoSummary } from './todoSummary';

const item = (
  status: ClaudeCodeTodoItem['status'],
  content: string,
  activeForm = `${content} (active)`,
): ClaudeCodeTodoItem => ({ activeForm, content, status });

describe('computeTodoSummary', () => {
  it('returns idle when args are missing or the list is empty', () => {
    expect(computeTodoSummary()).toEqual({ completed: 0, state: 'idle', total: 0 });
    expect(computeTodoSummary({ todos: [] })).toEqual({ completed: 0, state: 'idle', total: 0 });
  });

  it('returns idle when nothing is completed or in progress', () => {
    expect(computeTodoSummary({ todos: [item('pending', 'a'), item('pending', 'b')] })).toEqual({
      completed: 0,
      state: 'idle',
      total: 2,
    });
  });

  it('prefers the in-progress item, using its activeForm as detail', () => {
    expect(
      computeTodoSummary({
        todos: [item('completed', 'a'), item('in_progress', 'b'), item('pending', 'c')],
      }),
    ).toEqual({ completed: 1, detail: 'b (active)', state: 'inProgress', total: 3 });
  });

  it('falls back to content when the in-progress item has no activeForm', () => {
    expect(
      computeTodoSummary({ todos: [{ activeForm: '', content: 'b', status: 'in_progress' }] }),
    ).toEqual({ completed: 0, detail: 'b', state: 'inProgress', total: 1 });
  });

  // Regression: completed items + pending work with nothing in progress used to
  // fall through to the plain "Todos" (idle) label instead of surfacing the
  // most recently completed step.
  it('shows the last completed item when work remains and nothing is in progress', () => {
    expect(
      computeTodoSummary({
        todos: [item('completed', 'a'), item('completed', 'b'), item('pending', 'c')],
      }),
    ).toEqual({ completed: 2, detail: 'b', state: 'completedStep', total: 3 });
  });

  it('returns allDone when every item is completed', () => {
    expect(computeTodoSummary({ todos: [item('completed', 'a'), item('completed', 'b')] })).toEqual(
      { completed: 2, state: 'allDone', total: 2 },
    );
  });

  it('ignores null-ish entries from partially streamed args', () => {
    const todos = [item('completed', 'a'), null, item('pending', 'b')] as ClaudeCodeTodoItem[];
    expect(computeTodoSummary({ todos })).toEqual({
      completed: 1,
      detail: 'a',
      state: 'completedStep',
      total: 2,
    });
  });
});
