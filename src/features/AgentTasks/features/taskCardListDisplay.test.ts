import { describe, expect, it } from 'vitest';

import { getDisplayTaskCardTasks, getVisibleTaskCardTasks } from './taskCardListDisplay';

describe('taskCardListDisplay', () => {
  it('filters completed tasks from the card list', () => {
    const tasks = [
      { identifier: 'T-1', status: 'backlog' },
      { identifier: 'T-2', status: 'completed' },
      { identifier: 'T-3', status: 'running' },
    ] as any[];

    expect(getVisibleTaskCardTasks(tasks).map((task) => task.identifier)).toEqual(['T-1', 'T-3']);
  });

  it('sorts by recency and limits the number of displayed tasks', () => {
    const tasks = [
      { createdAt: '2026-04-20', identifier: 'T-1', status: 'backlog', updatedAt: '2026-04-20' },
      { createdAt: '2026-04-25', identifier: 'T-2', status: 'completed', updatedAt: '2026-04-25' },
      { createdAt: '2026-04-24', identifier: 'T-3', status: 'running', updatedAt: '2026-04-24' },
      { createdAt: '2026-04-23', identifier: 'T-4', status: 'paused', updatedAt: '2026-04-23' },
      { createdAt: '2026-04-22', identifier: 'T-5', status: 'failed', updatedAt: '2026-04-22' },
      { createdAt: '2026-04-21', identifier: 'T-6', status: 'backlog', updatedAt: '2026-04-21' },
      { createdAt: '2026-04-19', identifier: 'T-7', status: 'backlog', updatedAt: '2026-04-19' },
    ] as any[];

    expect(getDisplayTaskCardTasks(tasks).map((task) => task.identifier)).toEqual([
      'T-3',
      'T-4',
      'T-5',
      'T-6',
      'T-1',
    ]);
  });
});
