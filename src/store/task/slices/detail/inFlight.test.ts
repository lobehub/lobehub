import { TASK_STATUSES } from '@lobechat/builtin-tool-task';
import type { TaskDetailActivity, TaskDetailData, TaskDetailSubtask } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { hasInFlightActivity } from './inFlight';

const detail = (overrides: Partial<TaskDetailData> = {}): TaskDetailData => ({
  identifier: 'T-1',
  instruction: 'do it',
  status: 'backlog',
  ...overrides,
});

const subtask = (overrides: Partial<TaskDetailSubtask> = {}): TaskDetailSubtask => ({
  identifier: 'T-2',
  status: 'backlog',
  ...overrides,
});

const topic = (status: string): TaskDetailActivity => ({ status, type: 'topic' });

describe('hasInFlightActivity', () => {
  it('stops polling without a detail', () => {
    expect(hasInFlightActivity(undefined)).toBe(false);
  });

  it.each(TASK_STATUSES.map((status) => [status, status === 'running'] as const))(
    'polls a %s task only while it is running (%s)',
    (status, expected) => {
      expect(hasInFlightActivity(detail({ status }))).toBe(expected);
    },
  );

  it.each(TASK_STATUSES.map((status) => [status, status === 'running'] as const))(
    'polls for a nested %s subtask only while it is running (%s)',
    (status, expected) => {
      const nested = subtask({ children: [subtask({ identifier: 'T-3', status })] });
      expect(hasInFlightActivity(detail({ subtasks: [nested] }))).toBe(expected);
    },
  );

  it('polls while a settled subtask still has a running topic', () => {
    const settled = subtask({ runningTopic: { id: 'tpc_1' }, status: 'completed' });
    expect(hasInFlightActivity(detail({ subtasks: [settled] }))).toBe(true);
  });

  it('polls while a topic activity is pending or running', () => {
    expect(hasInFlightActivity(detail({ activities: [topic('pending')] }))).toBe(true);
    expect(hasInFlightActivity(detail({ activities: [topic('running')] }))).toBe(true);
    expect(hasInFlightActivity(detail({ activities: [topic('completed')] }))).toBe(false);
  });
});
