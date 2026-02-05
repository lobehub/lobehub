import type { BuiltinIntervention } from '@lobechat/types';

import { GTDApiName } from '../../types';
import AddTodoIntervention from './AddTodo';
import ClearTodosIntervention from './ClearTodos';
import CreatePlanIntervention from './CreatePlan';

/**
 * GTD Tool Intervention Components Registry
 *
 * Intervention components allow users to review and modify tool parameters
 * before the tool is executed.
 */
export const GTDInterventions: Record<string, BuiltinIntervention> = {
  [GTDApiName.clearTodos]: ClearTodosIntervention as BuiltinIntervention,
  [GTDApiName.createPlan]: CreatePlanIntervention as BuiltinIntervention,
  [GTDApiName.createTodos]: AddTodoIntervention as BuiltinIntervention,
};

export { default as AddTodoIntervention } from './AddTodo';
export { default as ClearTodosIntervention } from './ClearTodos';
export { default as CreatePlanIntervention } from './CreatePlan';
