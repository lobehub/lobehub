import type { AgentInterventionItem, NewAgentIntervention } from './agentIntervention';
import { agentInterventions } from './agentIntervention';

/** @deprecated Use `agentInterventions`. Kept while v1 Cloud consumers migrate. */
export const heterogeneousAgentInterventions = agentInterventions;

/** @deprecated Use `NewAgentIntervention`. */
export type NewHeterogeneousAgentIntervention = NewAgentIntervention;

/** @deprecated Use `AgentInterventionItem`. */
export type HeterogeneousAgentInterventionItem = AgentInterventionItem;
