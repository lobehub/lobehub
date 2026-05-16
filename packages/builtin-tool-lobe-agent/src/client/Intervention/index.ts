import type { BuiltinIntervention } from '@lobechat/types';

import { LobeAgentApiName } from '../../types';
import AddTodoIntervention from './AddTodo';
import ClearTodosIntervention from './ClearTodos';
import CreatePlanIntervention from './CreatePlan';

/**
 * Lobe Agent Intervention Components Registry
 *
 * Intervention components allow users to review and modify tool parameters
 * before the tool is executed.
 */
export const LobeAgentInterventions: Record<string, BuiltinIntervention> = {
  [LobeAgentApiName.clearTodos]: ClearTodosIntervention as BuiltinIntervention,
  [LobeAgentApiName.createPlan]: CreatePlanIntervention as BuiltinIntervention,
  [LobeAgentApiName.createTodos]: AddTodoIntervention as BuiltinIntervention,
};

export { default as AddTodoIntervention } from './AddTodo';
export { default as ClearTodosIntervention } from './ClearTodos';
export { default as CreatePlanIntervention } from './CreatePlan';
