import type { BuiltinRender } from '@lobechat/types';

import { TaskApiName } from '../../types';
import CreateTaskRender from './CreateTask';
import CreateTasksRender from './CreateTasks';
import RunTasksRender from './RunTasks';

/**
 * Task tool Render components registry.
 *
 * Only mutating create-style operations have a dedicated render — read
 * operations (list/view) and lightweight mutations (edit/status/delete)
 * present their results directly via the tool's text content.
 */
export const TaskRenders: Record<string, BuiltinRender> = {
  [TaskApiName.createTask]: CreateTaskRender as BuiltinRender,
  [TaskApiName.createTasks]: CreateTasksRender as BuiltinRender,
  [TaskApiName.runTasks]: RunTasksRender as BuiltinRender,
};

export { default as CreateTaskRender } from './CreateTask';
export { default as CreateTasksRender } from './CreateTasks';
export { default as RunTasksRender } from './RunTasks';
