import type { StepContextTodos } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { normalizeTaskProgress } from './taskProgressAdapter';

describe('normalizeTaskProgress', () => {
  it('maps message-derived todos into workspace progress state', () => {
    const result = normalizeTaskProgress({
      items: [
        { status: 'completed', text: 'Gather context' },
        { status: 'processing', text: 'Draft answer' },
        { status: 'todo', text: 'Send response' },
      ],
      updatedAt: '2026-04-02T00:00:00.000Z',
    } satisfies StepContextTodos);

    expect(result.completionPercent).toBe(33);
    expect(result.currentTask).toBe('Draft answer');
    expect(result.items).toEqual([
      { id: 'todo-0', status: 'completed', text: 'Gather context' },
      { id: 'todo-1', status: 'processing', text: 'Draft answer' },
      { id: 'todo-2', status: 'todo', text: 'Send response' },
    ]);
    expect(result.updatedAt).toBe('2026-04-02T00:00:00.000Z');
  });
});
