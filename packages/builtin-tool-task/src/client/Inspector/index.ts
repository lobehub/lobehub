import type { BuiltinInspector } from '@lobechat/types';

import { TaskApiName } from '../../types';
import { CreateTaskInspector } from './CreateTask';
import { CreateTasksInspector } from './CreateTasks';
import { DeleteTaskInspector } from './DeleteTask';
import { EditTaskInspector } from './EditTask';
import { ListTasksInspector } from './ListTasks';
import { RunTaskInspector } from './RunTask';
import { RunTasksInspector } from './RunTasks';
import { SetTaskScheduleInspector } from './SetTaskSchedule';
import {
  AddTaskCommentInspector,
  DeleteTaskCommentInspector,
  UpdateTaskCommentInspector,
} from './TaskComment';
import { UpdateTaskStatusInspector } from './UpdateTaskStatus';
import { ViewTaskInspector } from './ViewTask';

/**
 * Task tool Inspector components registry.
 *
 * Inspector components customize the title/header area of tool calls
 * in the conversation UI for the lobe-task built-in tool.
 */
export const TaskInspectors: Record<string, BuiltinInspector> = {
  [TaskApiName.addTaskComment]: AddTaskCommentInspector as BuiltinInspector,
  [TaskApiName.createTask]: CreateTaskInspector as BuiltinInspector,
  [TaskApiName.createTasks]: CreateTasksInspector as BuiltinInspector,
  [TaskApiName.deleteTask]: DeleteTaskInspector as BuiltinInspector,
  [TaskApiName.deleteTaskComment]: DeleteTaskCommentInspector as BuiltinInspector,
  [TaskApiName.editTask]: EditTaskInspector as BuiltinInspector,
  [TaskApiName.listTasks]: ListTasksInspector as BuiltinInspector,
  [TaskApiName.runTask]: RunTaskInspector as BuiltinInspector,
  [TaskApiName.runTasks]: RunTasksInspector as BuiltinInspector,
  [TaskApiName.setTaskSchedule]: SetTaskScheduleInspector as BuiltinInspector,
  [TaskApiName.updateTaskComment]: UpdateTaskCommentInspector as BuiltinInspector,
  [TaskApiName.updateTaskStatus]: UpdateTaskStatusInspector as BuiltinInspector,
  [TaskApiName.viewTask]: ViewTaskInspector as BuiltinInspector,
};

export { CreateTaskInspector } from './CreateTask';
export { CreateTasksInspector } from './CreateTasks';
export { DeleteTaskInspector } from './DeleteTask';
export { EditTaskInspector } from './EditTask';
export { ListTasksInspector } from './ListTasks';
export { RunTaskInspector } from './RunTask';
export { RunTasksInspector } from './RunTasks';
export { SetTaskScheduleInspector } from './SetTaskSchedule';
export {
  AddTaskCommentInspector,
  DeleteTaskCommentInspector,
  UpdateTaskCommentInspector,
} from './TaskComment';
export { UpdateTaskStatusInspector } from './UpdateTaskStatus';
export { ViewTaskInspector } from './ViewTask';
