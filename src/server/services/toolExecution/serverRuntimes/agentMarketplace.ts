import { AgentMarketplaceIdentifier } from '@lobechat/builtin-tool-agent-marketplace';
import { AgentMarketplaceExecutionRuntime } from '@lobechat/builtin-tool-agent-marketplace/executionRuntime';

import { type ServerRuntimeRegistration } from './types';

export const agentMarketplaceRuntime: ServerRuntimeRegistration = {
  factory: () => {
    return new AgentMarketplaceExecutionRuntime();
  },
  identifier: AgentMarketplaceIdentifier,
};
