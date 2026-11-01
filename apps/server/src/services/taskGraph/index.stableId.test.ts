import { describe, expect, it } from 'vitest';

import { planSubtaskLayers } from './index';

describe('subtask graph identity', () => {
  it('keeps distinct ids separate even if their display identifiers collide', () => {
    const plan = planSubtaskLayers([
      { id: 'task_old', identifier: 'T-1', status: 'completed', dependsOn: [] },
      { id: 'task_new', identifier: 'T-1', status: 'backlog', dependsOn: [] },
      { id: 'task_child', identifier: 'T-2', status: 'backlog', dependsOn: ['task_old'] },
    ]);
    expect(plan.alreadyDone).toEqual(['task_old']);
    expect(plan.layers).toEqual([['task_child', 'task_new']]);
  });
});
