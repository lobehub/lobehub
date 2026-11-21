import { describe, expect, it } from 'vitest';

import { buildTaskDetailPrompt } from './buildTaskDetailPrompt';
import { buildTaskListPrompt } from './buildTaskListPrompt';
import { buildTaskRunPrompt, formatTaskCreated, formatTaskDetail, taskRef } from './index';

describe('task identity in model output', () => {
  const task = {
    id: 'task_AbC',
    identifier: 'T-12',
    instruction: 'Ship it',
    name: 'Ship',
    status: 'backlog',
  };
  it('links using public identifiers while retaining stable ids as metadata', () => {
    expect(taskRef(task)).toBe('[T-12](/task/T-12) (id: task_AbC)');
    expect(formatTaskCreated(task)).toContain('[T-12](/task/T-12) (id: task_AbC)');
  });
  it('includes stable ids in list and detail contexts', () => {
    expect(buildTaskListPrompt({ tasks: [task], total: 1 })).toContain('T-12 (id: task_AbC)');
    expect(buildTaskDetailPrompt({ task })).toContain('T-12 (id: task_AbC)');
  });
  it('includes stable ids for related tasks in tool detail output', () => {
    const result = formatTaskDetail({
      ...task,
      parent: { id: 'task_parent', identifier: 'T-1', name: 'Parent' },
      dependencies: [{ dependsOn: 'T-2', dependsOnId: 'task_dependency', type: 'blocks' }],
    });
    expect(result).toContain('Parent: T-1 (id: task_parent)');
    expect(result).toContain('blocks: T-2 (id: task_dependency)');
  });
  it('keeps related ids in run context and marks the current sibling by id', () => {
    const result = buildTaskRunPrompt({
      task: {
        ...task,
        parentIdentifier: 'T-1',
        parentTaskId: 'task_parent',
        dependencies: [{ dependsOn: 'T-2', dependsOnId: 'task_dependency', type: 'blocks' }],
      },
      parentTask: {
        id: 'task_parent',
        identifier: 'T-1',
        instruction: 'Parent',
        subtasks: [{ ...task, id: 'task_other', name: 'Other' }, task],
      },
    });
    expect(result).toContain('Parent: T-1 (id: task_parent)');
    expect(result).toContain('blocks: T-2 (id: task_dependency)');
    expect(result.split('\n').find((line) => line.includes('task_other'))).not.toContain(
      '◀ current',
    );
    expect(result.match(/◀ current/g)).toHaveLength(1);
  });
});
