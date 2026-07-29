import type { BuiltinRender } from '@lobechat/types';

import { TaskApiName } from '../../types';
import CreateTaskRender from './CreateTask';
import CreateTasksRender from './CreateTasks';
import EditTaskRender from './EditTask';
import RunTaskRender from './RunTask';
import RunTasksRender from './RunTasks';
import SetTaskVerifyRender from './SetTaskVerify';

/**
 * Task tool Render components registry.
 *
 * Create-style and single-task mutation operations present a focused result
 * card; the remaining read operations (list/view) and lightweight mutations
 * (status/delete/comments) fall back to the generic argument/result render.
 */
export const TaskRenders: Record<string, BuiltinRender> = {
  [TaskApiName.createTask]: CreateTaskRender as BuiltinRender,
  [TaskApiName.createTasks]: CreateTasksRender as BuiltinRender,
  [TaskApiName.editTask]: EditTaskRender as BuiltinRender,
  [TaskApiName.runTask]: RunTaskRender as BuiltinRender,
  [TaskApiName.runTasks]: RunTasksRender as BuiltinRender,
  [TaskApiName.setTaskVerify]: SetTaskVerifyRender as BuiltinRender,
};

export { default as CreateTaskRender } from './CreateTask';
export { default as CreateTasksRender } from './CreateTasks';
export { default as EditTaskRender } from './EditTask';
export { default as RunTaskRender } from './RunTask';
export { default as RunTasksRender } from './RunTasks';
export { default as SetTaskVerifyRender } from './SetTaskVerify';
