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
 * Where an agent runs.
 * - `none`    : no execution environment — plain chat, no built-in run tools
 * - `auto`    : auto-pick a device — when exactly one is online it is activated
 *               automatically; with several online the model selects one via the
 *               remote-device tool. The ONLY mode that touches a device the user
 *               did not explicitly select. Opt-in: never a silent default.
 * - `local`   : in-process spawn on the user's Electron desktop (desktop only)
 * - `device`  : dispatched to an `lh connect` device identified by `boundDeviceId`
 * - `sandbox` : server-spawned cloud sandbox
 *
 * Remote hetero agents (`openclaw` | `hermes`) are always `device`.
 */
export type DeviceExecutionTarget = 'auto' | 'device' | 'local' | 'none' | 'sandbox';

/**
 * Agent agency configuration.
 * Contains settings for agent execution modes and device binding.
 */
export interface LobeAgentAgencyConfig {
  /**
   * Device ID of the machine connected via `lh connect`.
   * Required when `executionTarget === 'device'`. Also persisted for desktop
   * `local` selections so non-desktop clients can resolve "this machine" to the
   * concrete connected device instead of falling back to the sandbox.
   */
  boundDeviceId?: string;
  /**
   * Execution target for this agent. When omitted, resolves to a platform
   * default: `'local'` on desktop, `'none'` on web (or `'device'` for remote
   * hetero providers).
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

/**
 * Apply "undefined means delete" semantics to a `workingDirByDevice` patch.
 *
 * Deep-merge (used by both the client optimistic store and the server persist
 * path) can only add/overwrite keys — it silently skips `undefined` sources, so
 * it can never *remove* a per-device entry. To clear a device's cwd the patch
 * carries `{ [deviceId]: undefined }`; this prunes those keys from the merged
 * map after the merge has run.
 *
 * Mutates `merged` in place (safe on an immer draft) and is a no-op when the
 * patch touches no device entries.
 */
export const pruneWorkingDirByDeviceDeletes = (
  merged: { workingDirByDevice?: Record<string, string | undefined> } | null | undefined,
  patch: { workingDirByDevice?: Record<string, string | undefined> } | null | undefined,
): void => {
  const incoming = patch?.workingDirByDevice;
  const target = merged?.workingDirByDevice;
  if (!incoming || !target) return;

  for (const key of Object.keys(incoming)) {
    if (incoming[key] === undefined) delete target[key];
  }
};
