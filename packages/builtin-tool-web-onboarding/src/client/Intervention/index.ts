import type { BuiltinIntervention } from '@lobechat/types';

import { AgentMarketplaceInterventions } from '../../agentMarketplace/client/Intervention';
import { WebOnboardingApiName } from '../../types';
import SaveUserQuestionIntervention from './SaveUserQuestion';

export const WebOnboardingInterventions: Record<string, BuiltinIntervention> = {
  [WebOnboardingApiName.saveUserQuestion]: SaveUserQuestionIntervention as BuiltinIntervention,
  ...AgentMarketplaceInterventions,
};

export { default as SaveUserQuestionIntervention } from './SaveUserQuestion';
