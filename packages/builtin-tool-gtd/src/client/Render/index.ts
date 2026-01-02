import { GTDApiName } from '../../types';
import CreatePlan from './CreatePlan';
import ExecTaskRender from './ExecTask';
import ExecTasksRender from './ExecTasks';
import TodoListRender from './TodoList';

/**
 * GTD Tool Render Components Registry
 *
 * All todo operations use the same TodoList render component
 * which displays the current state of the todo list.
 * Plan operations use the CreatePlan render component.
 */
export const GTDRenders = {
  // All todo operations render the same TodoList UI
  [GTDApiName.clearTodos]: TodoListRender,
  [GTDApiName.completeTodos]: TodoListRender,
  [GTDApiName.createTodos]: TodoListRender,
  [GTDApiName.removeTodos]: TodoListRender,
  [GTDApiName.updateTodos]: TodoListRender,

  // Plan operations render the PlanCard UI
  [GTDApiName.createPlan]: CreatePlan,
  [GTDApiName.updatePlan]: CreatePlan,

  // Async task operations
  [GTDApiName.execTask]: ExecTaskRender,
  [GTDApiName.execTasks]: ExecTasksRender,
};

export { default as CreatePlan, PlanCard } from './CreatePlan';
export { default as ExecTaskRender } from './ExecTask';
export { default as ExecTasksRender } from './ExecTasks';
export type { TodoListRenderState } from './TodoList';
export { default as TodoListRender, TodoListUI } from './TodoList';
