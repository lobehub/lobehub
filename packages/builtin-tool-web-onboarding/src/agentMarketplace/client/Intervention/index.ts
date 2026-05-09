import type { BuiltinIntervention } from '@lobechat/types';

import { AgentMarketplaceApiName } from '../../types';
import PickAgentsIntervention from './PickAgents';

export const AgentMarketplaceInterventions: Record<string, BuiltinIntervention> = {
  [AgentMarketplaceApiName.showAgentMarketplace]: PickAgentsIntervention as BuiltinIntervention,
};
