import type { AgentSignalMiddleware } from '../runtime/middleware';
import { botWakeScenario } from './botWake/scenario';
import { selfIterationScenario } from './selfIteration';
import type {
  AgentSignalScenario,
  AgentSignalScenarioId,
  AgentSignalScenarioPolicyOptions,
} from './types';

export const AGENT_SIGNAL_SCENARIOS: Readonly<Record<AgentSignalScenarioId, AgentSignalScenario>> =
  {
    'bot-wake': botWakeScenario,
    'self-iteration': selfIterationScenario,
  };

export const getAgentSignalScenario = (id: AgentSignalScenarioId): AgentSignalScenario =>
  AGENT_SIGNAL_SCENARIOS[id];

/** Policy middleware installed for one scenario. */
export const createScenarioPolicies = (
  id: AgentSignalScenarioId,
  options: AgentSignalScenarioPolicyOptions = {},
): AgentSignalMiddleware[] => getAgentSignalScenario(id).createPolicies(options);
