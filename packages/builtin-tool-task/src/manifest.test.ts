import { describe, expect, it } from 'vitest';

import { TaskManifest } from './manifest';
import { TaskApiName } from './types';

describe('TaskManifest Work semantics', () => {
  it('keeps goal orchestration outside the task tool scope', () => {
    const createTask = TaskManifest.api.find((api) => api.name === TaskApiName.createTask);

    expect(TaskManifest.api.some((api) => api.name === TaskApiName.createGoal)).toBe(false);
    expect(createTask?.work).toEqual({ action: 'create', resourceType: 'task' });
  });
});
