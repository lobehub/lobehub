/**
 * Selector value that means "do not override the underlying CLI".
 *
 * When persisted, it intentionally does not translate into CLI flags; the
 * underlying CLI keeps using its own settings, env vars, and account defaults.
 */
export const HETEROGENEOUS_AGENT_DEFAULT_SELECTION = 'default' as const;

export type HeterogeneousAgentDefaultSelection = typeof HETEROGENEOUS_AGENT_DEFAULT_SELECTION;

/**
 * Claude Code reasoning-effort levels, mirrored 1:1 with the CLI's
 * `--effort <level>` flag.
 */
export const CLAUDE_CODE_REASONING_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ClaudeCodeReasoningEffort = (typeof CLAUDE_CODE_REASONING_EFFORT_LEVELS)[number];

export const CLAUDE_CODE_DEFAULT_MODEL = 'sonnet';
export const CLAUDE_CODE_DEFAULT_REASONING_EFFORT = 'high' satisfies ClaudeCodeReasoningEffort;

/**
 * Codex reasoning-effort levels, mirrored to the CLI config key
 * `model_reasoning_effort`.
 */
export const CODEX_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_LEVELS)[number];

export const CODEX_DEFAULT_MODEL = 'gpt-5.5';
export const CODEX_DEFAULT_REASONING_EFFORT = 'medium' satisfies CodexReasoningEffort;
export const CODEX_REASONING_EFFORT_CONFIG_KEY = 'model_reasoning_effort';

export type HeterogeneousReasoningEffort =
  | ClaudeCodeReasoningEffort
  | CodexReasoningEffort
  | HeterogeneousAgentDefaultSelection;

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
  /**
   * Reasoning effort, surfaced through the chat-input model selector and
   * translated into the provider-specific CLI flags/config at spawn time.
   * Omitted or `'default'` values are displayed as Default in the UI and are
   * not passed as CLI overrides, so the CLI can keep its own settings, env
   * vars, and account defaults.
   */
  effort?: HeterogeneousReasoningEffort;
  /** Custom environment variables (local CLI only). */
  env?: Record<string, string>;
  /**
   * CLI model, surfaced through the chat-input model selector and translated
   * into the provider-specific model override at spawn time. Empty / omitted
   * values are displayed as Default in the UI, but are not passed as CLI flags
   * so the CLI can keep its own settings, env vars, and account defaults.
   */
  model?: string;
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

interface ClaudeCodeSelectionSource {
  args?: string[];
  effort?: string | null;
  model?: string | null;
}

interface CodexSelectionSource {
  args?: string[];
  effort?: string | null;
  model?: string | null;
}

const CODEX_CONFIG_FLAGS = ['-c', '--config'] as const;
const CODEX_MODEL_FLAGS = ['-m', '--model'] as const;
const HETERO_EXEC_AGENT_ARG_FLAG = '--agent-arg';

const hasCliFlag = (args: string[], flag: string): boolean =>
  args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));

const hasAnyCliFlag = (args: string[], flags: readonly string[]): boolean =>
  flags.some((flag) => hasCliFlag(args, flag));

const getCliFlagValue = (args: string[] | undefined, flag: string): string | undefined => {
  if (!args) return undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const next = args[index + 1]?.trim();
      if (next && !next.startsWith('-')) return next;
    }

    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      if (value) return value;
    }
  }

  return undefined;
};

const getAnyCliFlagValue = (
  args: string[] | undefined,
  flags: readonly string[],
): string | undefined => {
  for (const flag of flags) {
    const value = getCliFlagValue(args, flag);
    if (value) return value;
  }
};

const unquoteCliConfigValue = (value: string): string => {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseCliConfigAssignment = (assignment: string, key: string): string | undefined => {
  const match = assignment.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.+?)\\s*$`));
  if (!match?.[1]) return undefined;

  const value = unquoteCliConfigValue(match[1]);
  return value || undefined;
};

const getCliConfigValue = (args: string[] | undefined, key: string): string | undefined => {
  if (!args) return undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (CODEX_CONFIG_FLAGS.includes(arg as (typeof CODEX_CONFIG_FLAGS)[number])) {
      const next = args[index + 1];
      if (next) {
        const value = parseCliConfigAssignment(next, key);
        if (value) return value;
        index += 1;
      }
      continue;
    }

    const configFlag = CODEX_CONFIG_FLAGS.find((flag) => arg.startsWith(`${flag}=`));
    if (configFlag) {
      const value = parseCliConfigAssignment(arg.slice(configFlag.length + 1), key);
      if (value) return value;
    }
  }
};

const hasCliConfigKey = (args: string[], key: string): boolean => !!getCliConfigValue(args, key);

const isClaudeCodeReasoningEffort = (
  value: string | undefined,
): value is ClaudeCodeReasoningEffort =>
  !!value && CLAUDE_CODE_REASONING_EFFORT_LEVELS.includes(value as ClaudeCodeReasoningEffort);

const isCodexReasoningEffort = (value: string | undefined): value is CodexReasoningEffort =>
  !!value && CODEX_REASONING_EFFORT_LEVELS.includes(value as CodexReasoningEffort);

export const resolveClaudeCodeModel = (
  source: ClaudeCodeSelectionSource | null | undefined,
): string => {
  const model = (getCliFlagValue(source?.args, '--model') ?? source?.model)?.trim();
  return model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION
    ? model
    : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

export const resolveClaudeCodeReasoningEffort = (
  source: ClaudeCodeSelectionSource | null | undefined,
): ClaudeCodeReasoningEffort | HeterogeneousAgentDefaultSelection => {
  const effort = (getCliFlagValue(source?.args, '--effort') ?? source?.effort)?.trim();
  return isClaudeCodeReasoningEffort(effort) ? effort : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

const getExplicitClaudeCodeModel = (
  source: ClaudeCodeSelectionSource | null | undefined,
): string | undefined => {
  const model = source?.model?.trim();
  return model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION ? model : undefined;
};

const getExplicitClaudeCodeReasoningEffort = (
  source: ClaudeCodeSelectionSource | null | undefined,
): ClaudeCodeReasoningEffort | undefined => {
  const effort = source?.effort?.trim();
  return isClaudeCodeReasoningEffort(effort) ? effort : undefined;
};

export const resolveCodexModel = (source: CodexSelectionSource | null | undefined): string => {
  const model = (
    getAnyCliFlagValue(source?.args, CODEX_MODEL_FLAGS) ??
    getCliConfigValue(source?.args, 'model') ??
    source?.model
  )?.trim();

  return model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION
    ? model
    : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

export const resolveCodexReasoningEffort = (
  source: CodexSelectionSource | null | undefined,
): CodexReasoningEffort | HeterogeneousAgentDefaultSelection => {
  const effort = (
    getCliConfigValue(source?.args, CODEX_REASONING_EFFORT_CONFIG_KEY) ?? source?.effort
  )?.trim();

  return isCodexReasoningEffort(effort) ? effort : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

const getExplicitCodexModel = (
  source: CodexSelectionSource | null | undefined,
): string | undefined => {
  const model = source?.model?.trim();
  return model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION ? model : undefined;
};

const getExplicitCodexReasoningEffort = (
  source: CodexSelectionSource | null | undefined,
): CodexReasoningEffort | undefined => {
  const effort = source?.effort?.trim();
  return isCodexReasoningEffort(effort) ? effort : undefined;
};

/**
 * Resolve the effective native CLI args for a heterogeneous spawn.
 *
 * For `claude-code` and `codex`, the chat-input selector persists explicit
 * `model` + `effort` selections on the provider config; this is the single
 * place that maps those stored settings onto provider-specific argv for direct
 * local desktop spawns.
 * Missing/default settings are resolved by the UI helpers for display only.
 * They are not appended here because CLI overrides must not mask each CLI's
 * own settings/env/account defaults. User-authored `args` win, so there is
 * never a duplicate flag/config override.
 *
 * Returns `provider.args` unchanged (possibly `undefined`) when there is
 * nothing to inject, preserving the prior `args: provider.args` behavior for
 * every other provider type.
 */
export const buildHeteroSpawnArgs = (
  provider: HeterogeneousProviderConfig | undefined | null,
): string[] | undefined => {
  if (!provider) return undefined;
  if (provider.type !== 'claude-code' && provider.type !== 'codex') return provider.args;

  const baseArgs = provider.args ?? [];
  const extraArgs: string[] = [];

  if (provider.type === 'claude-code') {
    const model = getExplicitClaudeCodeModel(provider);
    if (model && !hasCliFlag(baseArgs, '--model')) extraArgs.push('--model', model);
    const effort = getExplicitClaudeCodeReasoningEffort(provider);
    if (effort && !hasCliFlag(baseArgs, '--effort')) extraArgs.push('--effort', effort);
  }

  if (provider.type === 'codex') {
    const model = getExplicitCodexModel(provider);
    if (
      model &&
      !hasAnyCliFlag(baseArgs, CODEX_MODEL_FLAGS) &&
      !hasCliConfigKey(baseArgs, 'model')
    ) {
      extraArgs.push('--model', model);
    }

    const effort = getExplicitCodexReasoningEffort(provider);
    if (effort && !hasCliConfigKey(baseArgs, CODEX_REASONING_EFFORT_CONFIG_KEY)) {
      extraArgs.push('-c', `${CODEX_REASONING_EFFORT_CONFIG_KEY}="${effort}"`);
    }
  }

  if (extraArgs.length === 0) return provider.args;
  return [...baseArgs, ...extraArgs];
};

/**
 * Resolve args for the `lh hetero exec` wrapper.
 *
 * Unlike `buildHeteroSpawnArgs`, these args are consumed by the LobeHub CLI
 * wrapper first, not by the native agent binary. Native provider args are
 * encoded with `--agent-arg=<arg>` so wrapper flags such as `-c, --command`
 * never collide with Codex/Claude flags. Keep selector overrides in the
 * wrapper's `--model` / `--effort` form; `lh hetero exec` translates them into
 * native Codex config immediately before `spawnAgent`.
 */
export const buildHeteroExecArgs = (
  provider: HeterogeneousProviderConfig | undefined | null,
): string[] | undefined => {
  if (!provider) return undefined;
  if (provider.type !== 'claude-code' && provider.type !== 'codex') return provider.args;

  const baseArgs = provider.args ?? [];
  const wrapperArgs = baseArgs.map((arg) => `${HETERO_EXEC_AGENT_ARG_FLAG}=${arg}`);
  const selectorArgs: string[] = [];

  if (provider.type === 'claude-code') {
    const model = getExplicitClaudeCodeModel(provider);
    if (model && !hasCliFlag(baseArgs, '--model')) selectorArgs.push('--model', model);
    const effort = getExplicitClaudeCodeReasoningEffort(provider);
    if (effort && !hasCliFlag(baseArgs, '--effort')) selectorArgs.push('--effort', effort);
  }

  if (provider.type === 'codex') {
    const model = getExplicitCodexModel(provider);
    if (
      model &&
      !hasAnyCliFlag(baseArgs, CODEX_MODEL_FLAGS) &&
      !hasCliConfigKey(baseArgs, 'model')
    ) {
      selectorArgs.push('--model', model);
    }

    const effort = getExplicitCodexReasoningEffort(provider);
    if (
      effort &&
      !hasCliFlag(baseArgs, '--effort') &&
      !hasCliConfigKey(baseArgs, CODEX_REASONING_EFFORT_CONFIG_KEY)
    ) {
      selectorArgs.push('--effort', effort);
    }
  }

  const args = [...wrapperArgs, ...selectorArgs];
  return args.length > 0 ? args : undefined;
};

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
