import {
  isHeterogeneousProviderBindingSupported,
  isServerDefaultHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';

/** Deployment relay support does not require user-provider credentials support. */
export const supportsHeterogeneousApiMode = (agentType: string): boolean =>
  isHeterogeneousProviderBindingSupported(agentType) ||
  isServerDefaultHeterogeneousAgentType(agentType);
