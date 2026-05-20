// Inspector components (customized tool call headers)
export {
  AddTaskCommentInspector,
  CreateTaskInspector,
  CreateTasksInspector,
  DeleteTaskCommentInspector,
  DeleteTaskInspector,
  EditTaskInspector,
  ListTasksInspector,
  RunTaskInspector,
  RunTasksInspector,
  TaskInspectors,
  UpdateTaskCommentInspector,
  UpdateTaskStatusInspector,
  ViewTaskInspector,
} from './Inspector';

// Render components (read-only snapshots)
export { CreateTaskRender, CreateTasksRender, RunTasksRender, TaskRenders } from './Render';

// Client-side executor (browser runtime adapter for the agent)
export { taskExecutor } from './executor';

// Re-export manifest and types for convenience
export { TaskIdentifier, TaskManifest } from '../manifest';
export * from '../types';
