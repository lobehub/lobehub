import { AgentMarketplaceIdentifier } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { AgentMarketplaceExecutionRuntime } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace/executionRuntime';

import { type ServerRuntimeRegistration } from './types';

export const agentMarketplaceRuntime: ServerRuntimeRegistration = {
  factory: () => {
    return new AgentMarketplaceExecutionRuntime();
  },
  identifier: AgentMarketplaceIdentifier,
};
