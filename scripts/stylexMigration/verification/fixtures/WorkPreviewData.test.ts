import { describe, expect, it } from 'vitest';

import { getWorkPreviewItem } from './WorkPreviewData';

describe('WorkPreview style input data', () => {
  it('uses statuses that actually select warning and info colors', () => {
    expect(getWorkPreviewItem('warning').status).toBe('in_progress');
    expect(getWorkPreviewItem('info').status).toBe('todo');
    expect(getWorkPreviewItem('document').status).toBe('completed');
  });

  it('mounts the declared resource branches with complete task data', () => {
    expect(['document', 'canvas', 'file', 'github', 'linear'].map((kind) => getWorkPreviewItem(kind).resourceType)).toEqual(['document', 'canvas', 'file', 'github_pull_request', 'linear_issue']);
    const task = getWorkPreviewItem('task-completed');
    expect(task.type).toBe('task');
    if (task.type !== 'task') throw new Error('TASK_FIXTURE_NOT_NARROWED');
    expect(task.task.status).toBe('completed');
  });
});
