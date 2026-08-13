import type { WorkingDirConfigValue } from '../device';
import type { LobeAgentChatConfig } from './chatConfig';
import { hasAnyCliFlag, hasCliConfigKey, hasCliFlag } from './heteroCliArgs';
import type { HeterogeneousAgentType, LocalHeterogeneousAgentType } from './heterogeneousAgent';
import {
  HETEROGENEOUS_AGENT_CONFIGS,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from './heterogeneousAgent';
import type {
  ClaudeCodeReasoningEffort,
  CodexReasoningEffort,
  CodexSpeedMode,
  HeteroCliEncoding,
  HeterogeneousReasoningEffort,
  HeterogeneousSpeedMode,
  QoderReasoningEffort,
} from './heteroSelectorCapabilities';
import {
  CODEX_REASONING_EFFORT_CONFIG_KEY,
  CODEX_SERVICE_TIER_CONFIG_KEY,
  HETERO_SELECTOR_CAPABILITIES,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
  isClaudeCodeReasoningEffort,
  isCodexFastServiceTier,
  isCodexReasoningEffort,
  isQoderReasoningEffort,
  QODER_REASONING_EFFORT_FLAG,
} from './heteroSelectorCapabilities';

export type HeterogeneousAgentModelCatalogErrorCode =
  'cli_not_found' | 'command_failed' | 'device_unavailable' | 'timeout' | 'unsupported_client';

/** One model reported by a heterogeneous CLI's device-local model catalog. */
export interface HeterogeneousAgentModel {
  /** Exact value accepted by the CLI's model-selection flag. Treat as opaque. */
  id: string;
  /** Optional human-readable model label. */
  label?: string;
  /** Model identifier shown when the CLI does not provide a separate display label. */
  modelId: string;
  /** Provider or CLI family, used only for display grouping. */
  providerId: string;
}

export interface ListHeterogeneousAgentModelsParams {
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  type: 'codebuddy' | 'opencode' | 'pi' | 'qoder';
}

export interface HeterogeneousAgentModelCatalogSuccess {
  models: HeterogeneousAgentModel[];
  status: 'success';
  updatedAt: number;
}

export interface HeterogeneousAgentModelCatalogFailure {
  error: {
    code: HeterogeneousAgentModelCatalogErrorCode;
    message: string;
  };
  status: 'error';
  updatedAt: number;
}

export type HeterogeneousAgentModelCatalog =
  HeterogeneousAgentModelCatalogFailure | HeterogeneousAgentModelCatalogSuccess;

/**
 * Heterogeneous agent provider configuration.
 * When set, the assistant delegates execution to an external agent runtime
 * instead of using the built-in model runtime.
 *
 * Two families of hetero agents are supported:
 *
 * - **Local CLI** (`amp` | `claude-code` | `codebuddy` | `codex` | `cursor` | `opencode` | `pi` | `qoder`): spawned as a child
 *   process on the desktop or a connected device; uses `command`, `args`, `env`,
 *   `systemContext`.
 *
 * - **Platform task** (`openclaw` | `hermes`): runs on this desktop when
 *   `executionTarget` is `local`, or on a machine connected via `lh connect`
 *   when it is `device`. `platformAgentId` selects the named platform agent.
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
   * Speed mode (Codex only), surfaced through the chat-input model selector
   * and translated into the `service_tier` CLI config at spawn time. Omitted
   * or `'default'` values are displayed as Standard in the UI and are not
   * passed as CLI overrides, so the CLI keeps its own settings and account
   * defaults.
   */
  speed?: HeterogeneousSpeedMode;
  /**
   * Static context prepended to every user prompt before it reaches the agent CLI.
   * Use this to prime the agent with workspace conventions, rules, or instructions
   * that should apply to every conversation.
   * Combined with any runtime-generated context (e.g. cloned repo list).
   */
  systemContext?: string;
  /** Agent runtime type, derived from the shared heterogeneous-agent descriptor catalog. */
  type: HeterogeneousAgentType;
}

const HETEROGENEOUS_AGENT_TYPES = new Set<string>([
  ...HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type),
  ...REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type),
]);

const LEGACY_COMMAND_INFERENCE_TYPES = new Set<LocalHeterogeneousAgentType>([
  'claude-code',
  'codex',
]);

interface LegacyHeterogeneousProviderConfig extends HeterogeneousProviderConfig {
  adapterType?: unknown;
}

const resolveKnownHeterogeneousAgentType = (value: unknown): HeterogeneousAgentType | undefined => {
  if (typeof value !== 'string' || !value) return;
  if (!HETEROGENEOUS_AGENT_TYPES.has(value)) {
    throw new Error(`Unknown heterogeneous agent type: "${value}"`);
  }
  return value as HeterogeneousAgentType;
};

/**
 * Upgrade a persisted provider config written before `type` became required.
 *
 * New callers must always write `type`; this compatibility path exists because
 * `agents.agency_config` is JSONB and older rows are not runtime-schema parsed
 * or backfilled. The old renderer preferred `adapterType`, then recognized
 * Claude/Codex from `command`, and otherwise defaulted to Claude Code.
 */
export const normalizeHeterogeneousProviderConfig = (
  config: HeterogeneousProviderConfig,
): HeterogeneousProviderConfig => {
  const legacyConfig = config as LegacyHeterogeneousProviderConfig;
  const explicitType = resolveKnownHeterogeneousAgentType(legacyConfig.type);
  if (explicitType && legacyConfig.adapterType === undefined) return config;

  const adapterType = explicitType
    ? undefined
    : resolveKnownHeterogeneousAgentType(legacyConfig.adapterType);
  const normalizedCommand = config.command?.trim().toLowerCase();
  const inferredType = normalizedCommand
    ? HETEROGENEOUS_AGENT_CONFIGS.find(
        ({ defaultCommand, type }) =>
          LEGACY_COMMAND_INFERENCE_TYPES.has(type) &&
          normalizedCommand.includes(defaultCommand.toLowerCase()),
      )?.type
    : undefined;
  const type = explicitType ?? adapterType ?? inferredType ?? 'claude-code';
  const normalizedConfig = { ...legacyConfig };
  delete normalizedConfig.adapterType;

  return { ...normalizedConfig, type };
};

const normalizeAgencyConfigHeterogeneousProvider = (
  agencyConfig: LobeAgentAgencyConfig | null | undefined,
): LobeAgentAgencyConfig | undefined => {
  const base = agencyConfig ?? undefined;
  if (!base?.heterogeneousProvider) return base;

  const heterogeneousProvider = normalizeHeterogeneousProviderConfig(base.heterogeneousProvider);
  return heterogeneousProvider === base.heterogeneousProvider
    ? base
    : { ...base, heterogeneousProvider };
};

interface ClaudeCodeSelectionSource {
  args?: string[];
  effort?: string | null;
  model?: string | null;
}

interface CodexSelectionSource {
  args?: string[];
  effort?: string | null;
  model?: string | null;
  speed?: string | null;
}

interface QoderSelectionSource {
  args?: string[];
  effort?: string | null;
  model?: string | null;
}

const HETERO_EXEC_AGENT_ARG_FLAG = '--agent-arg';

const modelFlagsOf = (type: 'codex' | 'opencode' | 'pi' | 'qoder'): readonly string[] =>
  HETERO_SELECTOR_CAPABILITIES[type].model.encodings.flatMap((encoding: HeteroCliEncoding) =>
    encoding.kind === 'flag' ? encoding.flags : [],
  );

const CODEX_MODEL_FLAGS = modelFlagsOf('codex');
const CURSOR_MODEL_FLAGS = ['--model'] as const;
const OPENCODE_MODEL_FLAGS = modelFlagsOf('opencode');
const PI_MODEL_FLAGS = modelFlagsOf('pi');
const QODER_MODEL_FLAGS = modelFlagsOf('qoder');

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

const getExplicitQoderReasoningEffort = (
  source: QoderSelectionSource | null | undefined,
): QoderReasoningEffort | undefined => {
  const effort = source?.effort?.trim();
  return isQoderReasoningEffort(effort) ? effort : undefined;
};

const getExplicitCodexSpeedMode = (
  source: CodexSelectionSource | null | undefined,
): CodexSpeedMode | undefined => {
  const speed = source?.speed?.trim();
  return isCodexFastServiceTier(speed) ? 'fast' : undefined;
};

/**
 * Resolve the effective native CLI args for a heterogeneous spawn.
 *
 * For `claude-code`, `codebuddy`, and `codex`, explicit `model` + `effort`
 * selections are persisted on the provider config; this is the single place
 * that maps those stored settings onto provider-specific argv for direct local
 * desktop spawns. OpenCode, Pi, and Qoder use their device-local model catalogs
 * and forward the selected model using the native `--model` flag.
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
  if (
    provider.type !== 'claude-code' &&
    provider.type !== 'codebuddy' &&
    provider.type !== 'codex' &&
    provider.type !== 'cursor' &&
    provider.type !== 'opencode' &&
    provider.type !== 'pi' &&
    provider.type !== 'qoder'
  ) {
    return provider.args;
  }

  const baseArgs = provider.args ?? [];
  const extraArgs: string[] = [];

  if (provider.type === 'claude-code' || provider.type === 'codebuddy') {
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

    const speed = getExplicitCodexSpeedMode(provider);
    if (speed && !hasCliConfigKey(baseArgs, CODEX_SERVICE_TIER_CONFIG_KEY)) {
      extraArgs.push('-c', `${CODEX_SERVICE_TIER_CONFIG_KEY}="${speed}"`);
    }
  }

  if (provider.type === 'opencode') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, OPENCODE_MODEL_FLAGS)
    ) {
      extraArgs.push('--model', model);
    }
  }

  if (provider.type === 'cursor') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, CURSOR_MODEL_FLAGS)
    ) {
      extraArgs.push('--model', model);
    }
  }

  if (provider.type === 'pi') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, PI_MODEL_FLAGS)
    ) {
      extraArgs.push('--model', model);
    }
  }

  if (provider.type === 'qoder') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, QODER_MODEL_FLAGS)
    ) {
      extraArgs.push('--model', model);
    }
    const effort = getExplicitQoderReasoningEffort(provider);
    if (effort && !hasCliFlag(baseArgs, QODER_REASONING_EFFORT_FLAG)) {
      extraArgs.push(QODER_REASONING_EFFORT_FLAG, effort);
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
 * native provider arguments immediately before `spawnAgent`.
 */
export const buildHeteroExecArgs = (
  provider: HeterogeneousProviderConfig | undefined | null,
): string[] | undefined => {
  if (!provider) return undefined;
  if (
    provider.type !== 'amp' &&
    provider.type !== 'claude-code' &&
    provider.type !== 'codebuddy' &&
    provider.type !== 'codex' &&
    provider.type !== 'cursor' &&
    provider.type !== 'opencode' &&
    provider.type !== 'pi' &&
    provider.type !== 'qoder'
  ) {
    return provider.args;
  }

  const baseArgs = provider.args ?? [];
  const wrapperArgs = baseArgs.map((arg) => `${HETERO_EXEC_AGENT_ARG_FLAG}=${arg}`);
  const selectorArgs: string[] = [];

  if (provider.type === 'claude-code' || provider.type === 'codebuddy') {
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

    const speed = getExplicitCodexSpeedMode(provider);
    if (
      speed &&
      !hasCliFlag(baseArgs, '--speed') &&
      !hasCliConfigKey(baseArgs, CODEX_SERVICE_TIER_CONFIG_KEY)
    ) {
      selectorArgs.push('--speed', speed);
    }
  }

  if (provider.type === 'opencode') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, OPENCODE_MODEL_FLAGS)
    ) {
      selectorArgs.push('--model', model);
    }
  }

  if (provider.type === 'cursor') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, CURSOR_MODEL_FLAGS)
    ) {
      selectorArgs.push('--model', model);
    }
  }

  if (provider.type === 'pi') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, PI_MODEL_FLAGS)
    ) {
      selectorArgs.push('--model', model);
    }
  }

  if (provider.type === 'qoder') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, QODER_MODEL_FLAGS)
    ) {
      selectorArgs.push('--model', model);
    }
    const effort = getExplicitQoderReasoningEffort(provider);
    if (effort && !hasCliFlag(baseArgs, QODER_REASONING_EFFORT_FLAG)) {
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
 * - `local`   : run on the user's Electron desktop (desktop only)
 * - `device`  : dispatched to an `lh connect` device identified by `boundDeviceId`
 * - `sandbox` : server-spawned cloud sandbox
 *
 * Platform task agents (`openclaw` | `hermes`) support `local` and `device` targets.
 */
export type DeviceExecutionTarget = 'auto' | 'device' | 'local' | 'none' | 'sandbox';

/**
 * Whether a workspace member may override the agent's shared execution target.
 *
 * - `member`: the shared config is a default; each member may override it
 * - `fixed`: every caller must use the shared execution target
 *
 * Missing values intentionally resolve as `member` for backwards compatibility.
 */
export type ExecutionTargetSelectionPolicy = 'fixed' | 'member';

/**
 * Controls whether a workspace agent always uses its shared model or lets
 * each member choose a personal model for that agent.
 *
 * Missing values resolve contextually: public Workspace Agents inherit the
 * current `member` default, while personal/private Agents remain fixed.
 */
export type AgentModelSelectionPolicy = 'fixed' | 'member';

/**
 * Agent agency configuration.
 * Contains settings for agent execution modes and device binding.
 */
export interface LobeAgentAgencyConfig {
  /**
   * Device ID of the machine connected via `lh connect`.
   * Required when `executionTarget === 'device'`.
   */
  boundDeviceId?: string;
  /**
   * Execution target for the hetero agent. When omitted, resolves to a
   * platform default: `'local'` on desktop and `'none'` on web.
   */
  executionTarget?: DeviceExecutionTarget;
  /**
   * Workspace execution-target selection policy. A fixed `device` target is
   * valid only with a public workspace device; other fixed targets do not bind
   * a device.
   */
  executionTargetSelectionPolicy?: ExecutionTargetSelectionPolicy;
  heterogeneousProvider?: HeterogeneousProviderConfig;
  /**
   * Confine the run's shell commands to the device sandbox. A *modifier* on
   * `executionTarget: 'local'`, not a target of its own — the run still goes to
   * the same machine through the same routing, it is only what the spawned
   * command may touch that changes (writes limited to the working directory,
   * no network).
   *
   * Modelled as a flag rather than a sixth `DeviceExecutionTarget` deliberately:
   * every existing routing rule (web coercion, gateway upgrade, bot-trigger
   * promotion, fixed-workspace policy) stays literally unchanged, and the flag
   * composes if sandboxed execution later extends to `device` targets.
   *
   * Only shell commands are affected. File tools (`writeFile` / `editFile`) run
   * in the desktop process itself, and heterogeneous CLI agents spawn through
   * their own path — neither passes through the sandboxed runner. Say
   * "commands" in user-facing copy, never "the agent".
   */
  localSandbox?: boolean;
  /**
   * Let the sandboxed commands reach the package-registry allowlist. Only
   * meaningful with {@link localSandbox}; defaults to off.
   *
   * A separate field rather than a tri-state on `localSandbox` because the two
   * answer different questions ("fence this?" vs "may the fence let installs
   * through?"), and because the network choice must survive toggling the
   * sandbox off and back on.
   *
   * Never means "the network is open" — the sandbox backend rejects a catch-all
   * allowlist outright, so this opens a fixed set of registries and forges.
   * User-facing copy must not promise more than that.
   */
  localSandboxNetwork?: boolean;
  /**
   * Workspace model-selection policy. `fixed` keeps the shared agent model
   * authoritative; `member` enables a per-user model override stored in
   * `workspace_user_settings.preference`. Missing values on public Workspace
   * Agents resolve to `member` for legacy rows.
   */
  modelSelectionPolicy?: AgentModelSelectionPolicy;
  /**
   * Model override for sub-agents this agent spawns via
   * `lobe-agent.callSubAgent`. When unset (or nulled to clear a previous
   * override), sub-agents follow the parent run's effective model — same
   * provider, same model. Configurable in the params panel; `null` rather than
   * `undefined` marks the cleared state because the config deep-merge skips
   * `undefined` and would resurrect the old override.
   */
  subagent?: {
    /**
     * chatConfig overrides (thinking / reasoning-effort extend params) for the
     * overridden sub-agent model, merged over the parent's chatConfig at spawn.
     * Only meaningful together with a `model` override — when sub-agents follow
     * the parent model they inherit the parent's chatConfig wholesale, so the
     * effort follows automatically.
     */
    chatConfig?: Partial<LobeAgentChatConfig> | null;
    model?: string | null;
    provider?: string | null;
  };
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
   * Per-device working directory source chosen for this agent. Key = `deviceId`
   * (the local machine uses its own gateway deviceId, so local and remote share
   * one model). This is the **agent-level** source in the resolution precedence:
   *
   *   `topic.metadata.workingDirectory`
   *     > effective path of `workingDirByDevice[targetDeviceId]`
   *     > `device.defaultCwd`
   *
   * Legacy values are plain path strings. New git-aware values may carry `git`
   * metadata; when `git.activeWorktree` is present, that active worktree is the
   * effective cwd while `path` remains the source/recent entry.
   *
   * Keyed per device so switching the bound device never resolves a path that
   * only exists on another machine. Persisted (server-synced) so the choice
   * follows the user across sessions / ends.
   */
  workingDirByDevice?: Record<string, WorkingDirConfigValue>;
}

/**
 * Explicit defaults written when a workspace agent is created.
 *
 * Members may choose their own model and execution environment by default.
 * Legacy public Workspace rows without a model policy resolve to the same
 * `member` default at runtime.
 */
export const DEFAULT_WORKSPACE_AGENT_SELECTION_POLICIES = {
  executionTargetSelectionPolicy: 'member',
  modelSelectionPolicy: 'member',
} as const satisfies Pick<
  LobeAgentAgencyConfig,
  'executionTargetSelectionPolicy' | 'modelSelectionPolicy'
>;

/**
 * The workspace-shared `agencyConfig` on the agent row is one row per agent —
 * inherently a *single* execution decision for the whole workspace. Real users
 * want each member to pick their own machine independently (see
 * `UserPreference.agentDeviceOverrides`). This helper merges the shared
 * baseline with the caller's per-agent override so every code path — client
 * device switcher, server dispatch, workingDir resolution — sees one
 * consistent "effective" config.
 *
 * Rules:
 * - `fixed` shared config ignores the caller override entirely
 * - `override.executionTarget` wins when set; falls back to shared
 * - `override.boundDeviceId` wins when set; falls back to shared
 * - `override.localSandbox` wins when set; falls back to shared. It rides along
 *   with the target because it qualifies *this member's* local execution — one
 *   member sandboxing their own machine says nothing about anyone else's.
 * - Nothing else (heterogeneousProvider, verifyRubricId, workingDirByDevice)
 *   is overridable — those describe the agent, not this user's routing
 *
 * A `null`-ish `override` is a no-op — safe to call on personal agents (where
 * no override ever exists) or on paths that don't yet know about the current
 * user's preference.
 */
export const resolveAgencyConfig = (
  agencyConfig: LobeAgentAgencyConfig | null | undefined,
  override:
    | Pick<
        LobeAgentAgencyConfig,
        'boundDeviceId' | 'executionTarget' | 'localSandbox' | 'localSandboxNetwork'
      >
    | null
    | undefined,
): LobeAgentAgencyConfig | undefined => {
  const base = normalizeAgencyConfigHeterogeneousProvider(agencyConfig);
  if (base?.executionTargetSelectionPolicy === 'fixed') return base;
  if (!override) return base;
  const hasTarget = override.executionTarget !== undefined;
  const hasDevice = override.boundDeviceId !== undefined;
  // `false` is a real value here — a member turning the sandbox (or its network
  // allowance) back off must override a shared `true`, so test for presence,
  // not truthiness.
  const hasLocalSandbox = override.localSandbox !== undefined;
  const hasLocalSandboxNetwork = override.localSandboxNetwork !== undefined;
  if (!hasTarget && !hasDevice && !hasLocalSandbox && !hasLocalSandboxNetwork) return base;
  return {
    ...base,
    ...(hasTarget ? { executionTarget: override.executionTarget } : {}),
    ...(hasDevice ? { boundDeviceId: override.boundDeviceId } : {}),
    ...(hasLocalSandbox ? { localSandbox: override.localSandbox } : {}),
    ...(hasLocalSandboxNetwork ? { localSandboxNetwork: override.localSandboxNetwork } : {}),
  };
};

export interface AgentAgencyConfigContext {
  /** Author/admin callers manage the shared config instead of using member overrides. */
  canManage?: boolean;
  visibility?: 'private' | 'public';
  workspaceId?: string | null;
}

/**
 * Resolve an Agent's effective agency config in its ownership context.
 *
 * Member execution-target policies and overrides apply only after a Workspace
 * Agent is public. A Private Agent remains owner-configurable: its shared
 * execution target is used directly, while the stored selection policy is
 * retained only as the policy that will take effect if the Agent is published.
 */
export const resolveAgentAgencyConfig = (
  agencyConfig: LobeAgentAgencyConfig | null | undefined,
  override:
    | Pick<
        LobeAgentAgencyConfig,
        'boundDeviceId' | 'executionTarget' | 'localSandbox' | 'localSandboxNetwork'
      >
    | null
    | undefined,
  context: AgentAgencyConfigContext,
): LobeAgentAgencyConfig | undefined => {
  const base = normalizeAgencyConfigHeterogeneousProvider(agencyConfig);
  const isPublicWorkspaceAgent =
    !!context.workspaceId && context.visibility !== 'private' && context.canManage !== true;

  if (isPublicWorkspaceAgent) return resolveAgencyConfig(base, override);

  if (!base?.executionTargetSelectionPolicy) return base;

  const { executionTargetSelectionPolicy, ...ownerConfig } = base;
  return executionTargetSelectionPolicy ? ownerConfig : base;
};

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
  merged: { workingDirByDevice?: Record<string, unknown> } | null | undefined,
  patch: { workingDirByDevice?: Record<string, unknown> } | null | undefined,
): void => {
  const incoming = patch?.workingDirByDevice;
  const target = merged?.workingDirByDevice;
  if (!incoming || !target) return;

  for (const key of Object.keys(incoming)) {
    if (incoming[key] === undefined) delete target[key];
  }
};
