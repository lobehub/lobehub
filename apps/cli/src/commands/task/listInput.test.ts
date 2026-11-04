import { describe, expect, it } from 'vitest';

import { toTaskGroupListInput, toTaskListInput } from './listInput';

describe('toTaskListInput', () => {
  it('splits multi-value filters', () => {
    expect(toTaskListInput({ priority: '0,2', status: 'backlog, scheduled' })).toEqual({
      priorities: [0, 2],
      statuses: ['backlog', 'scheduled'],
    });
  });

  it('maps the remaining filters', () => {
    expect(
      toTaskListInput({ completedWithin: 'week', content: 'cron', project: 'proj_1' }, ['user_1']),
    ).toEqual({
      completedWithin: 'week',
      filter: { assignee: { operator: 'is', values: ['user_1'] }, content: 'cron' },
      projectId: 'proj_1',
    });
  });

  it('rejects an unknown priority', () => {
    expect(() => toTaskListInput({ priority: '9' })).toThrow('Invalid priority');
  });
});

describe('toTaskGroupListInput', () => {
  it('moves status and priority into the filter', () => {
    expect(toTaskGroupListInput('priority', { priority: '1', status: 'running' })).toEqual({
      filter: {
        priority: { operator: 'is', values: [1] },
        status: { operator: 'is', values: ['running'] },
      },
      groupBy: 'priority',
    });
  });
});
