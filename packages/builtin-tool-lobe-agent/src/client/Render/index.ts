import { LobeAgentApiName } from '../../types';
import CallSubAgentRender from './CallSubAgent';
import CallSubAgentsRender from './CallSubAgents';
import CreatePlan from './CreatePlan';
import TodoListRender from './TodoList';

/**
 * Lobe Agent Tool Render Components Registry
 *
 * Sub-agent dispatch operations render a card showing the dispatched
 * task(s). Plan operations render the PlanCard UI. Todo operations
 * share a single TodoList render.
 */
export const LobeAgentRenders = {
  [LobeAgentApiName.callSubAgent]: CallSubAgentRender,
  [LobeAgentApiName.callSubAgents]: CallSubAgentsRender,

  // Plan operations render the PlanCard UI
  [LobeAgentApiName.createPlan]: CreatePlan,
  [LobeAgentApiName.updatePlan]: CreatePlan,

  // All todo operations render the same TodoList UI
  [LobeAgentApiName.clearTodos]: TodoListRender,
  [LobeAgentApiName.createTodos]: TodoListRender,
  [LobeAgentApiName.updateTodos]: TodoListRender,
};

export { default as CallSubAgentRender } from './CallSubAgent';
export { default as CallSubAgentsRender } from './CallSubAgents';
export { default as CreatePlan, PlanCard } from './CreatePlan';
export type { TodoListRenderState } from './TodoList';
export { default as TodoListRender, TodoListUI } from './TodoList';
