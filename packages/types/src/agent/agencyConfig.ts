/**
 * Heterogeneous agent provider configuration.
 * When set, the assistant delegates execution to an external agent CLI
 * instead of using the built-in model runtime.
 */
export interface HeterogeneousProviderConfig {
  /** Additional CLI arguments for the agent command */
  args?: string[];
  /** Command to spawn the agent (e.g. 'claude') */
  command?: string;
  /** Custom environment variables */
  env?: Record<string, string>;
  /**
   * Static context prepended to every user prompt before it reaches the agent CLI.
   * Use this to prime the agent with workspace conventions, rules, or instructions
   * that should apply to every conversation.
   * Combined with any runtime-generated context (e.g. cloned repo list).
   */
  systemContext?: string;
  /** Agent runtime type */
  type: 'claude-code' | 'codex';
}

/**
 * Agent agency configuration.
 * Contains settings for agent execution modes and device binding.
 */
export interface LobeAgentAgencyConfig {
  boundDeviceId?: string;
  heterogeneousProvider?: HeterogeneousProviderConfig;
}
