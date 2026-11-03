import type { BuiltinIntervention } from '@lobechat/types';

import { WebOnboardingApiName } from '../../../types';
import PickAgentsIntervention from './PickAgents';

export const AgentMarketplaceInterventions: Record<string, BuiltinIntervention> = {
  [WebOnboardingApiName.showAgentMarketplace]: PickAgentsIntervention as BuiltinIntervention,
};
