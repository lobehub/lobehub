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
 * - **Remote device** (`openclaw` | `hermes` | `amp` | `opencode`): dispatched to a machine
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
  type: 'amp' | 'claude-code' | 'codex' | 'hermes' | 'opencode' | 'openclaw';
}

/**
 * Where a hetero agent runs.
 * - `none`    : no execution environment — plain chat, no built-in run tools
 * - `local`   : in-process spawn on the user's Electron desktop (desktop only)
 * - `device`  : dispatched to an `lh connect` device identified by `boundDeviceId`
 * - `sandbox` : server-spawned cloud sandbox
 *
 * Remote hetero agents (`openclaw` | `hermes`) are always `device`.
 */
export type DeviceExecutionTarget = 'device' | 'local' | 'none' | 'sandbox';

/**
 * Agent agency configuration.
 * Contains settings for agent execution modes and device binding.
 */
export interface LobeAgentAgencyConfig {
  /**
   * Device ID of the machine connected via `lh connect`.
   * Required when `executionTarget === 'device'` (and always set for remote
   * hetero agents `openclaw` / `hermes`).
   */
  boundDeviceId?: string;
  /**
   * Execution target for the hetero agent. When omitted, resolves to a
   * platform default: `'local'` on desktop, `'none'` on web (or `'device'` for
   * remote hetero providers).
   */
  executionTarget?: DeviceExecutionTarget;
  heterogeneousProvider?: HeterogeneousProviderConfig;
  /**
   * Ad-hoc verify criteria mounted directly on this agent, in addition to any
   * `verifyRubricId`. Use for one-off checks that don't warrant a reusable
   * rubric. References `verify_criteria.id`.
   */
  verifyCriteriaIds?: string[];
  /**
   * Verify (delivery checker) rubric (reusable criteria template) mounted on
   * this agent. Every run instantiates this rubric's criteria — together with
   * any `verifyCriteriaIds` — into its check plan. References `verify_rubrics.id`.
   */
  verifyRubricId?: string;
  /**
   * Per-device working directory chosen for this agent. Key = `deviceId` (the
   * local machine uses its own gateway deviceId, so local and remote share one
   * model). This is the **agent-level** cwd in the resolution precedence:
   *
   *   `topic.metadata.workingDirectory`
   *     > `workingDirByDevice[targetDeviceId]`
   *     > `device.defaultCwd`
   *
   * Keyed per device so switching the bound device never resolves a path that
   * only exists on another machine. Persisted (server-synced) so the choice
   * follows the user across sessions / ends.
   */
  workingDirByDevice?: Record<string, string>;
}
