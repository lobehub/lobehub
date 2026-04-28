import { describe, expect, it } from 'vitest';

import { buildTaskListPrompt } from './buildTaskListPrompt';

const NOW = new Date('2026-03-22T12:00:00Z');

describe('buildTaskListPrompt', () => {
  it('renders empty state when no tasks', () => {
    const result = buildTaskListPrompt({ tasks: [], total: 0 }, NOW);
    expect(result).toMatchSnapshot();
    expect(result).toContain('(no tasks)');
  });

  it('renders a short list with total equal to shown count', () => {
    const result = buildTaskListPrompt(
      {
        tasks: [
          {
            identifier: 'T-1',
            name: 'Write chapter 1',
            priority: 2,
            status: 'running',
            createdAt: '2026-03-22T09:00:00Z',
          },
          {
            identifier: 'T-2',
            name: 'Review outline',
            priority: 3,
            status: 'backlog',
            createdAt: '2026-03-21T12:00:00Z',
          },
        ],
        total: 2,
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('Total: 2');
    expect(result).not.toContain('most recent');
  });

  it('notes truncation when total exceeds shown count', () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({
      identifier: `T-${i + 1}`,
      name: `Task ${i + 1}`,
      priority: 3,
      status: 'backlog',
      createdAt: '2026-03-22T10:00:00Z',
    }));

    const result = buildTaskListPrompt({ tasks, total: 120 }, NOW);

    expect(result).toMatchSnapshot();
    expect(result).toContain('Total: 120 (showing most recent 3)');
    expect(result).toContain('Only the most recent 3 tasks');
    expect(result).toContain('`listTasks`');
  });

  it('omits created-at suffix when tasks lack createdAt', () => {
    const result = buildTaskListPrompt(
      {
        tasks: [{ identifier: 'T-1', name: 'Untimed', priority: null, status: 'backlog' }],
        total: 1,
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).not.toContain('ago');
  });
});
