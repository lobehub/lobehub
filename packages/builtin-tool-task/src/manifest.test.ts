import { describe, expect, it } from 'vitest';

import { TaskManifest } from './manifest';
import { TaskApiName } from './types';

describe('TaskManifest Work semantics', () => {
  it('keeps Goal as a virtual message artifact instead of a persisted Work', () => {
    const createGoal = TaskManifest.api.find((api) => api.name === TaskApiName.createGoal);
    const createTask = TaskManifest.api.find((api) => api.name === TaskApiName.createTask);

    expect(createGoal?.work).toBeUndefined();
    expect(createTask?.work).toEqual({ action: 'create', resourceType: 'task' });
  });
});
