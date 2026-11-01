import { AskUserQuestionIntervention } from '@lobechat/builtin-tool-user-interaction/client';
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
 *
 * `askUserQuestion` reuses the standalone user-interaction card: it renders as
 * an inline custom form (not the default approve/reject) — see
 * `isCustomInteractionIdentifier` in customInteractionHandlers.
 */
export const LobeAgentInterventions: Record<string, BuiltinIntervention> = {
  [LobeAgentApiName.askUserQuestion]: AskUserQuestionIntervention as BuiltinIntervention,
  [LobeAgentApiName.clearTodos]: ClearTodosIntervention as BuiltinIntervention,
  [LobeAgentApiName.createPlan]: CreatePlanIntervention as BuiltinIntervention,
  [LobeAgentApiName.createTodos]: AddTodoIntervention as BuiltinIntervention,
};

export { default as AddTodoIntervention } from './AddTodo';
export { default as ClearTodosIntervention } from './ClearTodos';
export { default as CreatePlanIntervention } from './CreatePlan';
