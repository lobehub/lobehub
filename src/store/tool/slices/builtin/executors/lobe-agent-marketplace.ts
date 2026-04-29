import { AgentMarketplaceExecutionRuntime } from '@lobechat/builtin-tool-agent-marketplace/executionRuntime';
import { AgentMarketplaceExecutor } from '@lobechat/builtin-tool-agent-marketplace/executor';

import {
  trackOnboardingMarketplacePicked,
  trackOnboardingMarketplaceShown,
} from '@/services/onboardingMetrics';

const runtime = new AgentMarketplaceExecutionRuntime({
  onPicked: (payload) => {
    trackOnboardingMarketplacePicked(payload);
  },
  onShown: (payload) => {
    trackOnboardingMarketplaceShown(payload);
  },
});

export const agentMarketplaceExecutor = new AgentMarketplaceExecutor(runtime);
