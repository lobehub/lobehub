/**
 * Heterogeneous agent provider configuration.
 * When set, the assistant delegates execution to an external agent runtime
 * instead of using the built-in model runtime.
 *
 * Two families of hetero agents are supported:
 *
 * - **Local CLI** (`claude-code` | `codex`): spawned as a child process on the
 *   desktop; uses `command`, `args`, `env`, `systemContext`.
 *
 * - **Remote device** (`openclaw` | `hermes`): dispatched to a machine
 *   connected via `lh connect`; device is identified by `LobeAgentAgencyConfig.boundDeviceId`.
 *   `platformAgentId` selects the named agent on the remote platform (defaults to `'main'`).
 */
export interface HeterogeneousProviderConfig {
  /** Additional CLI arguments for the agent command (local CLI only). */
  args?: string[];
  /** Command to spawn the agent (e.g. 'claude') (local CLI only). */
  command?: string;
  /** Custom environment variables (local CLI only). */
  env?: Record<string, string>;
  /**
   * Platform-side agent identifier used by remote device runtimes.
   * - openclaw: selects the named agent (defaults to `'main'`)
   * - hermes: reserved for future use
   */
  platformAgentId?: string;
  /**
   * Static context prepended to every user prompt before it reaches the agent CLI.
   * Use this to prime the agent with workspace conventions, rules, or instructions
   * that should apply to every conversation.
   * Combined with any runtime-generated context (e.g. cloned repo list).
   */
  systemContext?: string;
  /** Agent runtime type. */
  type: 'claude-code' | 'codex' | 'hermes' | 'openclaw';
}

/**
 * Agent agency configuration.
 * Contains settings for agent execution modes and device binding.
 *
 * For remote hetero agents (`type: 'openclaw' | 'hermes'`), `boundDeviceId`
 * identifies the target `lh connect` device and is required.
 */
export interface LobeAgentAgencyConfig {
  /**
   * Device ID of the machine connected via `lh connect`.
   * Required when `heterogeneousProvider.type` is `'openclaw'` or `'hermes'`.
   */
  boundDeviceId?: string;
  heterogeneousProvider?: HeterogeneousProviderConfig;
}
