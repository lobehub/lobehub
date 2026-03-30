export const TaskApiName = {
  /** Create a new task, optionally as a subtask of another task */
  createTask: 'createTask',

  /** Delete a task */
  deleteTask: 'deleteTask',

  /** Edit a task's name, instruction, priority, dependencies, or review config */
  editTask: 'editTask',

  /** List tasks with optional filters */
  listTasks: 'listTasks',

  /** Update a task's status (e.g. complete, cancel) */
  updateTaskStatus: 'updateTaskStatus',

  /** View details of a specific task */
  viewTask: 'viewTask',
} as const;

export type TaskApiNameType = (typeof TaskApiName)[keyof typeof TaskApiName];
