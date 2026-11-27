import { describe, expect, it } from 'vitest';

import { SCHEDULED_TASK_VIEW_MODES } from './AgentTasksPage';
import { ALL_TASK_VIEW_MODES, resolveOfferedViewMode } from './TasksGroupConfig';

describe('resolveOfferedViewMode', () => {
  it('keeps a mode the collection offers', () => {
    expect(resolveOfferedViewMode('calendar', ALL_TASK_VIEW_MODES)).toBe('calendar');
    expect(resolveOfferedViewMode('kanban', ALL_TASK_VIEW_MODES)).toBe('kanban');
    expect(resolveOfferedViewMode('calendar', SCHEDULED_TASK_VIEW_MODES)).toBe('calendar');
  });

  it('reads a board stored from another tab as the scheduled list', () => {
    expect(resolveOfferedViewMode('kanban', SCHEDULED_TASK_VIEW_MODES)).toBe('list');
  });
});
