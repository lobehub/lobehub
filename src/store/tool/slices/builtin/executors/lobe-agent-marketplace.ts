import { AgentMarketplaceExecutionRuntime } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace/executionRuntime';
import { AgentMarketplaceExecutor } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace/executor';

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
