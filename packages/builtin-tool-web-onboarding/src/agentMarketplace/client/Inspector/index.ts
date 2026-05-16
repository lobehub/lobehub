import type { BuiltinInspector } from '@lobechat/types';

import { WebOnboardingApiName } from '../../../types';
import { ShowAgentMarketplaceInspector } from './ShowAgentMarketplace';
import { SubmitAgentPickInspector } from './SubmitAgentPick';

export const AgentMarketplaceInspectors: Record<string, BuiltinInspector> = {
  [WebOnboardingApiName.showAgentMarketplace]: ShowAgentMarketplaceInspector as BuiltinInspector,
  [WebOnboardingApiName.submitAgentPick]: SubmitAgentPickInspector as BuiltinInspector,
};

export { default as ShowAgentMarketplaceInspector } from './ShowAgentMarketplace';
export { default as SubmitAgentPickInspector } from './SubmitAgentPick';
