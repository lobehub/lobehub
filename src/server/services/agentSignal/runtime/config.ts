import { AGENT_SIGNAL_RUNTIME_BACKENDS } from '../constants';

/** Inputs used to resolve the runtime backend configuration. */
export interface ResolveAgentSignalRuntimeConfigOptions {
  enableAgentSignalRuntime: boolean;
  enableDurableRuntime: boolean;
}

/** Resolved configuration for the AgentSignal runtime host. */
export interface AgentSignalRuntimeConfig {
  backend: (typeof AGENT_SIGNAL_RUNTIME_BACKENDS)[keyof typeof AGENT_SIGNAL_RUNTIME_BACKENDS];
  durableRuntimeEnabled: boolean;
  runtimeEnabled: boolean;
}

/**
 * Resolves the AgentSignal runtime configuration.
 *
 * Use when:
 * - Callers need the normalized runtime feature flags
 * - The runtime should always target the local in-memory backend surface
 *
 * Expects:
 * - Feature flags are already parsed into booleans
 *
 * Returns:
 * - A normalized config object with the memory backend selected
 */
export const resolveAgentSignalRuntimeConfig = (
  input: ResolveAgentSignalRuntimeConfigOptions,
): AgentSignalRuntimeConfig => {
  const runtimeEnabled = input.enableAgentSignalRuntime;

  return {
    backend: AGENT_SIGNAL_RUNTIME_BACKENDS.memory,
    durableRuntimeEnabled: runtimeEnabled && input.enableDurableRuntime,
    runtimeEnabled,
  };
};
