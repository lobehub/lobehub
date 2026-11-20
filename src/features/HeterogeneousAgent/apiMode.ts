import {
  isHeterogeneousProviderBindingSupported,
  isServerDefaultHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget, HeterogeneousAuthMode } from '@lobechat/types';

/** Deployment relay support does not require user-provider credentials support. */
export const supportsHeterogeneousApiMode = (agentType: string): boolean =>
  isHeterogeneousProviderBindingSupported(agentType) ||
  isServerDefaultHeterogeneousAgentType(agentType);

/**
 * API-mode auth runs only in-process on this desktop: dispatch
 * (`selectRuntimeType`) rejects it on any other target. Surfaces that show a
 * non-local environment use this to offer the way back to subscription auth.
 */
export const isApiAuthBlockedOnTarget = (
  authMode: HeterogeneousAuthMode | undefined,
  target: DeviceExecutionTarget,
): boolean => authMode === 'api' && target !== 'local';
