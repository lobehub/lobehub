import {
  getAnyCliFlagValue,
  getCliConfigValue,
  getCliFlagValue,
  hasAnyCliFlag,
  hasCliConfigKey,
  hasCliFlag,
  stripCliConfigKey,
  stripCliFlags,
} from './heteroCliArgs';
import type { HeterogeneousAgentType, LocalHeterogeneousAgentType } from './heterogeneousAgent';

/**
 * Selector value that means "do not override the underlying CLI".
 *
 * When persisted, it intentionally does not translate into CLI flags; the
 * underlying CLI keeps using its own settings, env vars, and account defaults.
 */
export const HETEROGENEOUS_AGENT_DEFAULT_SELECTION = 'default' as const;

export type HeterogeneousAgentDefaultSelection = typeof HETEROGENEOUS_AGENT_DEFAULT_SELECTION;

/** Amp agent modes, mirrored 1:1 with the CLI's `--mode <mode>` flag. */
export const AMP_AGENT_MODES = ['low', 'medium', 'high', 'ultra'] as const;

export type AmpAgentMode = (typeof AMP_AGENT_MODES)[number];

export type HeterogeneousAgentMode = AmpAgentMode | HeterogeneousAgentDefaultSelection;

/**
 * Claude Code reasoning-effort levels, mirrored 1:1 with the CLI's
 * `--effort <level>` flag.
 */
const CLAUDE_CODE_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ClaudeCodeReasoningEffort = (typeof CLAUDE_CODE_REASONING_EFFORT_LEVELS)[number];

/** Grok Build reasoning-effort levels accepted by the CLI's `--effort` flag. */
const GROK_BUILD_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

export type GrokBuildReasoningEffort = (typeof GROK_BUILD_REASONING_EFFORT_LEVELS)[number];

export const GROK_BUILD_REASONING_EFFORT_FLAGS = ['--effort', '--reasoning-effort'] as const;

/**
 * Codex reasoning-effort levels, mirrored to the CLI config key
 * `model_reasoning_effort`.
 */
const CODEX_COMMON_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

const CODEX_REASONING_EFFORT_LEVELS = [
  ...CODEX_COMMON_REASONING_EFFORT_LEVELS,
  'max',
  'ultra',
] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORT_LEVELS)[number];

export const CODEX_REASONING_EFFORT_CONFIG_KEY = 'model_reasoning_effort';

/**
 * Non-OpenAI models with hand-tuned Codex catalog metadata (reasoning levels,
 * truncation). Not an allowlist: any tool-capable relay model is offered to
 * Codex, and models outside this list get a catalog entry built from their
 * model card.
 */
export const CODEX_SERVER_DEFAULT_CUSTOM_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'glm-5.2',
] as const;

export type CodexServerDefaultCustomModel = (typeof CODEX_SERVER_DEFAULT_CUSTOM_MODELS)[number];

const CODEX_DEEPSEEK_V4_REASONING_EFFORT_LEVELS = ['low', 'high', 'max'] as const;
const CODEX_GLM_5_2_REASONING_EFFORT_LEVELS = ['high', 'max'] as const;

const CODEX_MAX_REASONING_EFFORT_LEVELS = [
  ...CODEX_COMMON_REASONING_EFFORT_LEVELS,
  'max',
] as const satisfies readonly CodexReasoningEffort[];

const CODEX_ULTRA_REASONING_MODELS = ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra'] as const;
const CODEX_MAX_REASONING_MODELS = ['gpt-6-astra', 'gpt-5.6-luna'] as const;

/**
 * Qoder reasoning-effort levels, mirrored 1:1 with the CLI's
 * `--reasoning-effort <level>` flag.
 */
const QODER_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type QoderReasoningEffort = (typeof QODER_REASONING_EFFORT_LEVELS)[number];

export const QODER_REASONING_EFFORT_FLAG = '--reasoning-effort';

/**
 * GitHub Copilot CLI reasoning-effort levels, mirrored 1:1 with the CLI's
 * `--reasoning-effort <level>` flag and ACP `reasoning_effort` config option.
 */
const COPILOT_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type CopilotReasoningEffort = (typeof COPILOT_REASONING_EFFORT_LEVELS)[number];

export const COPILOT_REASONING_EFFORT_FLAG = '--reasoning-effort';

export type HeterogeneousReasoningEffortLevel =
  | ClaudeCodeReasoningEffort
  | CodexReasoningEffort
  | CopilotReasoningEffort
  | GrokBuildReasoningEffort
  | QoderReasoningEffort;

export type HeterogeneousReasoningEffort =
  HeterogeneousReasoningEffortLevel | HeterogeneousAgentDefaultSelection;

/** Explicit Codex speed selections; normal sends the standard service tier. */
export type CodexSpeedMode = 'normal' | 'fast' | 'ultrafast';

export type HeterogeneousSpeedMode = CodexSpeedMode | HeterogeneousAgentDefaultSelection;

export const CODEX_SERVICE_TIER_CONFIG_KEY = 'service_tier';

/** Default is a selector sentinel; Normal explicitly requests standard processing. */
export const toCodexServiceTier = (speed: string): string =>
  speed === 'normal' ? 'default' : speed;

/**
 * `service_tier` values the Codex CLI resolves to the Fast tier
 * (`ServiceTier::from_request_value` accepts both spellings).
 */
const CODEX_FAST_SERVICE_TIER_VALUES = ['fast', 'priority'] as const;

export const isAmpAgentMode = (value: string | undefined): value is AmpAgentMode =>
  !!value && AMP_AGENT_MODES.includes(value as AmpAgentMode);

export const isClaudeCodeReasoningEffort = (
  value: string | undefined,
): value is ClaudeCodeReasoningEffort =>
  !!value && CLAUDE_CODE_REASONING_EFFORT_LEVELS.includes(value as ClaudeCodeReasoningEffort);

export const isCodexReasoningEffort = (value: string | undefined): value is CodexReasoningEffort =>
  !!value && CODEX_REASONING_EFFORT_LEVELS.includes(value as CodexReasoningEffort);

export const isCodexServerDefaultCustomModel = (
  model: string,
): model is CodexServerDefaultCustomModel =>
  CODEX_SERVER_DEFAULT_CUSTOM_MODELS.includes(model as CodexServerDefaultCustomModel);

export const isGrokBuildReasoningEffort = (
  value: string | undefined,
): value is GrokBuildReasoningEffort =>
  !!value && GROK_BUILD_REASONING_EFFORT_LEVELS.includes(value as GrokBuildReasoningEffort);

export const isQoderReasoningEffort = (value: string | undefined): value is QoderReasoningEffort =>
  !!value && QODER_REASONING_EFFORT_LEVELS.includes(value as QoderReasoningEffort);

export const isCopilotReasoningEffort = (
  value: string | undefined,
): value is CopilotReasoningEffort =>
  !!value && COPILOT_REASONING_EFFORT_LEVELS.includes(value as CopilotReasoningEffort);

export const isCodexFastServiceTier = (value: string | undefined): boolean =>
  !!value &&
  CODEX_FAST_SERVICE_TIER_VALUES.includes(value as (typeof CODEX_FAST_SERVICE_TIER_VALUES)[number]);

/**
 * Reasoning-effort levels exposed by a Codex model. Unknown and default model
 * selections use the conservative common set because their actual capability
 * cannot be known until the CLI resolves the model.
 */
export const getCodexReasoningEffortLevels = (model: string): readonly CodexReasoningEffort[] => {
  if (model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro') {
    return CODEX_DEEPSEEK_V4_REASONING_EFFORT_LEVELS;
  }

  if (model === 'glm-5.2') return CODEX_GLM_5_2_REASONING_EFFORT_LEVELS;

  if (
    CODEX_ULTRA_REASONING_MODELS.includes(model as (typeof CODEX_ULTRA_REASONING_MODELS)[number])
  ) {
    return CODEX_REASONING_EFFORT_LEVELS;
  }

  if (CODEX_MAX_REASONING_MODELS.includes(model as (typeof CODEX_MAX_REASONING_MODELS)[number])) {
    return CODEX_MAX_REASONING_EFFORT_LEVELS;
  }

  return CODEX_COMMON_REASONING_EFFORT_LEVELS;
};

export interface HeteroSelectionSource {
  args?: string[];
  effort?: string | null;
  mode?: string | null;
  model?: string | null;
  speed?: string | null;
}

export const resolveAmpAgentMode = (
  source: HeteroSelectionSource | null | undefined,
): HeterogeneousAgentMode => {
  const mode = (getCliFlagValue(source?.args, '--mode') ?? source?.mode)?.trim();
  return isAmpAgentMode(mode) ? mode : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

const CODEX_MODEL_FLAGS = ['-m', '--model'] as const;

export const resolveClaudeCodeModel = (
  source: HeteroSelectionSource | null | undefined,
): string => {
  const model = (getCliFlagValue(source?.args, '--model') ?? source?.model)?.trim();
  return model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION
    ? model
    : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

export const resolveClaudeCodeReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): ClaudeCodeReasoningEffort | HeterogeneousAgentDefaultSelection => {
  const effort = (getCliFlagValue(source?.args, '--effort') ?? source?.effort)?.trim();
  return isClaudeCodeReasoningEffort(effort) ? effort : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

export const resolveCodexModel = (source: HeteroSelectionSource | null | undefined): string => {
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
  source: HeteroSelectionSource | null | undefined,
): CodexReasoningEffort | HeterogeneousAgentDefaultSelection => {
  const effort = (
    getCliConfigValue(source?.args, CODEX_REASONING_EFFORT_CONFIG_KEY) ?? source?.effort
  )?.trim();

  return isCodexReasoningEffort(effort) ? effort : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

export const resolveCodexSpeedMode = (
  source: HeteroSelectionSource | null | undefined,
): HeterogeneousSpeedMode => {
  const tier = (
    getCliConfigValue(source?.args, CODEX_SERVICE_TIER_CONFIG_KEY) ?? source?.speed
  )?.trim();

  if (
    tier === 'default' &&
    getCliConfigValue(source?.args, CODEX_SERVICE_TIER_CONFIG_KEY) !== undefined
  )
    return 'normal';
  if (tier === 'normal' || tier === 'ultrafast') return tier;
  return isCodexFastServiceTier(tier) ? 'fast' : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

const resolveGrokBuildReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): GrokBuildReasoningEffort | HeterogeneousAgentDefaultSelection => {
  const effort = (
    getAnyCliFlagValue(source?.args, GROK_BUILD_REASONING_EFFORT_FLAGS) ?? source?.effort
  )?.trim();
  return isGrokBuildReasoningEffort(effort) ? effort : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

const resolveQoderReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): QoderReasoningEffort | HeterogeneousAgentDefaultSelection => {
  const effort = (
    getCliFlagValue(source?.args, QODER_REASONING_EFFORT_FLAG) ?? source?.effort
  )?.trim();
  return isQoderReasoningEffort(effort) ? effort : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

const resolveCopilotReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): CopilotReasoningEffort | HeterogeneousAgentDefaultSelection => {
  const effort = (
    getCliFlagValue(source?.args, COPILOT_REASONING_EFFORT_FLAG) ?? source?.effort
  )?.trim();
  return isCopilotReasoningEffort(effort) ? effort : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

/**
 * Catalog providers persist the picked model id verbatim and never read it back
 * out of `args`. Widening them to the arg-first order that `buildHeteroSpawnArgs`
 * uses would change what the selector displays for hand-authored configs, so the
 * asymmetry is deliberate rather than an oversight.
 */
const resolvePersistedModel = (source: HeteroSelectionSource | null | undefined): string => {
  const model = source?.model?.trim();
  return model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION
    ? model
    : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

export type HeteroCliEncoding =
  { flags: readonly string[]; kind: 'flag' } | { key: string; kind: 'config' };

export interface HeteroSelectorModelCapability {
  /**
   * Native argv/config spellings for providers selected before process start.
   * Protocol-native agents such as TRAE apply the persisted value after ACP
   * session setup and therefore intentionally expose no CLI encoding.
   */
  encodings: readonly HeteroCliEncoding[];
  /**
   * Flags cleared together with the model but never read back as its value.
   * Pi spells the provider half of a fully-qualified model id separately, so a
   * stale `--provider` would contradict a freshly picked model.
   */
  extraStripFlags?: readonly string[];
  resolve: (source: HeteroSelectionSource | null | undefined) => string;
  /**
   * `catalog` providers enumerate models through a device-local CLI call;
   * `static` providers accept a small fixed set of aliases and must keep
   * working with no device attached.
   */
  source: 'catalog' | 'static';
}

export interface HeteroSelectorEffortCapability {
  encodings: readonly HeteroCliEncoding[];
  levels: (model: string) => readonly HeterogeneousReasoningEffortLevel[];
  resolve: (source: HeteroSelectionSource | null | undefined) => HeterogeneousReasoningEffort;
}

export interface HeteroSelectorSpeedCapability {
  encodings: readonly HeteroCliEncoding[];
  resolve: (source: HeteroSelectionSource | null | undefined) => HeterogeneousSpeedMode;
}

export interface HeteroSelectorModeCapability {
  encodings: readonly HeteroCliEncoding[];
  levels: readonly AmpAgentMode[];
  resolve: (source: HeteroSelectionSource | null | undefined) => HeterogeneousAgentMode;
}

export interface HeteroSelectorCapability {
  effort?: HeteroSelectorEffortCapability;
  mode?: HeteroSelectorModeCapability;
  model?: HeteroSelectorModelCapability;
  speed?: HeteroSelectorSpeedCapability;
}

const MODEL_FLAGS_ENCODING = { flags: ['-m', '--model'], kind: 'flag' } as const;

/**
 * Which selector dimensions each CLI agent exposes, and how each dimension is
 * spelled on its command line.
 *
 * This is the single source of truth for both directions: the chat-input
 * selector reads it to render dimensions and to clear contradicting args when
 * the user picks a value, and `buildHeteroSpawnArgs` reads it to decide whether
 * user-authored args already cover a dimension.
 */
export const HETERO_SELECTOR_CAPABILITIES = {
  'amp': {
    mode: {
      encodings: [{ flags: ['--mode'], kind: 'flag' }],
      levels: AMP_AGENT_MODES,
      resolve: resolveAmpAgentMode,
    },
  },
  'claude-code': {
    effort: {
      encodings: [{ flags: ['--effort'], kind: 'flag' }],
      levels: () => CLAUDE_CODE_REASONING_EFFORT_LEVELS,
      resolve: resolveClaudeCodeReasoningEffort,
    },
    model: {
      encodings: [{ flags: ['--model'], kind: 'flag' }],
      resolve: resolveClaudeCodeModel,
      source: 'static',
    },
  },
  'codebuddy': {
    effort: {
      encodings: [{ flags: ['--effort'], kind: 'flag' }],
      levels: () => CLAUDE_CODE_REASONING_EFFORT_LEVELS,
      resolve: resolveClaudeCodeReasoningEffort,
    },
    model: {
      encodings: [{ flags: ['--model'], kind: 'flag' }],
      resolve: resolveClaudeCodeModel,
      source: 'catalog',
    },
  },
  'codex': {
    effort: {
      encodings: [{ key: CODEX_REASONING_EFFORT_CONFIG_KEY, kind: 'config' }],
      levels: getCodexReasoningEffortLevels,
      resolve: resolveCodexReasoningEffort,
    },
    model: {
      encodings: [MODEL_FLAGS_ENCODING, { key: 'model', kind: 'config' }],
      resolve: resolveCodexModel,
      source: 'catalog',
    },
    speed: {
      encodings: [{ key: CODEX_SERVICE_TIER_CONFIG_KEY, kind: 'config' }],
      resolve: resolveCodexSpeedMode,
    },
  },
  'copilot': {
    effort: {
      encodings: [{ flags: [COPILOT_REASONING_EFFORT_FLAG], kind: 'flag' }],
      levels: () => COPILOT_REASONING_EFFORT_LEVELS,
      resolve: resolveCopilotReasoningEffort,
    },
    model: {
      encodings: [{ flags: ['--model'], kind: 'flag' }],
      resolve: resolvePersistedModel,
      source: 'catalog',
    },
  },
  'cursor': {
    model: {
      encodings: [{ flags: ['--model'], kind: 'flag' }],
      resolve: resolvePersistedModel,
      source: 'catalog',
    },
  },
  'droid': {
    model: { encodings: [], resolve: resolvePersistedModel, source: 'catalog' },
  },
  'devin': {
    model: {
      encodings: [{ flags: ['--model'], kind: 'flag' }],
      resolve: resolvePersistedModel,
      source: 'catalog',
    },
  },
  'grok-build': {
    effort: {
      encodings: [{ flags: GROK_BUILD_REASONING_EFFORT_FLAGS, kind: 'flag' }],
      levels: () => GROK_BUILD_REASONING_EFFORT_LEVELS,
      resolve: resolveGrokBuildReasoningEffort,
    },
    model: {
      encodings: [MODEL_FLAGS_ENCODING],
      resolve: resolvePersistedModel,
      source: 'catalog',
    },
  },
  'kimi-code': {
    model: { encodings: [MODEL_FLAGS_ENCODING], resolve: resolvePersistedModel, source: 'catalog' },
  },
  'opencode': {
    model: { encodings: [MODEL_FLAGS_ENCODING], resolve: resolvePersistedModel, source: 'catalog' },
  },
  'pi': {
    model: {
      encodings: [{ flags: ['--model'], kind: 'flag' }],
      extraStripFlags: ['--provider'],
      resolve: resolvePersistedModel,
      source: 'catalog',
    },
  },
  'qoder': {
    effort: {
      encodings: [{ flags: [QODER_REASONING_EFFORT_FLAG], kind: 'flag' }],
      levels: () => QODER_REASONING_EFFORT_LEVELS,
      resolve: resolveQoderReasoningEffort,
    },
    model: { encodings: [MODEL_FLAGS_ENCODING], resolve: resolvePersistedModel, source: 'catalog' },
  },
  'trae': {
    model: { encodings: [], resolve: resolvePersistedModel, source: 'catalog' },
  },
} satisfies Record<LocalHeterogeneousAgentType, HeteroSelectorCapability>;

export const getHeteroSelectorCapability = (
  type: string | undefined,
): HeteroSelectorCapability | undefined =>
  HETERO_SELECTOR_CAPABILITIES[type as LocalHeterogeneousAgentType];

export const isHeteroSelectorAvailable = (type: string | undefined): boolean =>
  Object.keys(getHeteroSelectorCapability(type) ?? {}).length > 0;

export interface HeteroSelection {
  effort?: HeterogeneousReasoningEffort;
  mode?: HeterogeneousAgentMode;
  model?: string;
  speed?: HeterogeneousSpeedMode;
}

export interface HeteroSelectionPatch extends HeteroSelection {
  args?: string[];
}

interface HeteroSelectionTarget {
  args?: string[];
  type?: string;
}

const clearEncodings = (
  args: string[] | undefined,
  encodings: readonly HeteroCliEncoding[],
  extraStripFlags?: readonly string[],
): string[] | undefined => {
  let next = args;

  for (const encoding of encodings) {
    next =
      encoding.kind === 'flag'
        ? stripCliFlags(next, encoding.flags)
        : stripCliConfigKey(next, encoding.key);
  }

  return extraStripFlags?.length ? stripCliFlags(next, extraStripFlags) : next;
};

/**
 * Translate a selector pick into a provider-config patch.
 *
 * `buildHeteroSpawnArgs` treats user-authored `args` as winning over the
 * structured fields, so a pick that left a contradicting flag in `args` would
 * silently never take effect. Clearing the flags this dimension is spelled with
 * is what makes the selection observable.
 */
export const applyHeteroSelection = (
  provider: HeteroSelectionTarget | null | undefined,
  selection: HeteroSelection,
): HeteroSelectionPatch => {
  const patch: HeteroSelectionPatch = { ...selection };
  const capability = getHeteroSelectorCapability(provider?.type);
  if (!capability) return patch;

  let args = provider?.args;
  let cleared = false;

  if ('model' in selection && capability.model) {
    args = clearEncodings(args, capability.model.encodings, capability.model.extraStripFlags);
    cleared = true;
  }

  if ('effort' in selection && capability.effort) {
    args = clearEncodings(args, capability.effort.encodings);
    cleared = true;
  }

  if ('mode' in selection && capability.mode) {
    args = clearEncodings(args, capability.mode.encodings);
    cleared = true;
  }

  if ('speed' in selection && capability.speed) {
    args = clearEncodings(args, capability.speed.encodings);
    cleared = true;
  }

  if (cleared) patch.args = args;

  return patch;
};

export type HeterogeneousCatalogAgentType = {
  [
    K in keyof typeof HETERO_SELECTOR_CAPABILITIES
  ]: (typeof HETERO_SELECTOR_CAPABILITIES)[K] extends {
    model: { source: 'catalog' };
  }
    ? K
    : never;
}[keyof typeof HETERO_SELECTOR_CAPABILITIES];

export interface HeteroSpawnSelectionProvider extends HeteroSelectionSource {
  type: HeterogeneousAgentType;
}

const HETERO_EXEC_AGENT_ARG_FLAG = '--agent-arg';

const modelFlagsOf = (
  type: 'codex' | 'copilot' | 'grok-build' | 'kimi-code' | 'opencode' | 'pi' | 'qoder',
): readonly string[] =>
  HETERO_SELECTOR_CAPABILITIES[type].model.encodings.flatMap((encoding: HeteroCliEncoding) =>
    encoding.kind === 'flag' ? encoding.flags : [],
  );

const COPILOT_MODEL_FLAGS = modelFlagsOf('copilot');
const CURSOR_MODEL_FLAGS = ['--model'] as const;
const GROK_BUILD_MODEL_FLAGS = modelFlagsOf('grok-build');
const KIMI_CODE_MODEL_FLAGS = modelFlagsOf('kimi-code');
const OPENCODE_MODEL_FLAGS = modelFlagsOf('opencode');
const PI_MODEL_FLAGS = modelFlagsOf('pi');
const QODER_MODEL_FLAGS = modelFlagsOf('qoder');

const getExplicitAmpAgentMode = (
  source: HeteroSelectionSource | null | undefined,
): AmpAgentMode | undefined => {
  const mode = source?.mode?.trim();
  return isAmpAgentMode(mode) ? mode : undefined;
};

const getExplicitClaudeCodeModel = (
  source: HeteroSelectionSource | null | undefined,
): string | undefined => {
  const model = source?.model?.trim();
  return model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION ? model : undefined;
};

const getExplicitClaudeCodeReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): ClaudeCodeReasoningEffort | undefined => {
  const effort = source?.effort?.trim();
  return isClaudeCodeReasoningEffort(effort) ? effort : undefined;
};

const getExplicitCodexModel = (
  source: HeteroSelectionSource | null | undefined,
): string | undefined => {
  const model = source?.model?.trim();
  return model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION ? model : undefined;
};

const getExplicitCodexReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): CodexReasoningEffort | undefined => {
  const effort = source?.effort?.trim();
  return isCodexReasoningEffort(effort) ? effort : undefined;
};

const getExplicitCopilotReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): CopilotReasoningEffort | undefined => {
  const effort = source?.effort?.trim();
  return isCopilotReasoningEffort(effort) ? effort : undefined;
};

const getExplicitGrokBuildReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): GrokBuildReasoningEffort | undefined => {
  const effort = source?.effort?.trim();
  return isGrokBuildReasoningEffort(effort) ? effort : undefined;
};

const getExplicitQoderReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): QoderReasoningEffort | undefined => {
  const effort = source?.effort?.trim();
  return isQoderReasoningEffort(effort) ? effort : undefined;
};

const getExplicitCodexSpeedMode = (
  source: HeteroSelectionSource | null | undefined,
): CodexSpeedMode | undefined => {
  const speed = source?.speed?.trim();
  if (speed === 'normal' || speed === 'ultrafast') return speed;
  return isCodexFastServiceTier(speed) ? 'fast' : undefined;
};

/**
 * Resolve the effective native CLI args for a heterogeneous spawn.
 */
export const buildHeteroSpawnArgs = (
  provider: HeteroSpawnSelectionProvider | undefined | null,
): string[] | undefined => {
  if (!provider) return undefined;
  if (
    provider.type !== 'amp' &&
    provider.type !== 'claude-code' &&
    provider.type !== 'codebuddy' &&
    provider.type !== 'codex' &&
    provider.type !== 'copilot' &&
    provider.type !== 'cursor' &&
    provider.type !== 'droid' &&
    provider.type !== 'devin' &&
    provider.type !== 'grok-build' &&
    provider.type !== 'kimi-code' &&
    provider.type !== 'opencode' &&
    provider.type !== 'pi' &&
    provider.type !== 'qoder' &&
    provider.type !== 'trae'
  ) {
    return provider.args;
  }

  const baseArgs = provider.args ?? [];
  const extraArgs: string[] = [];

  if (provider.type === 'amp') {
    const mode = getExplicitAmpAgentMode(provider);
    if (mode && !hasCliFlag(baseArgs, '--mode')) extraArgs.push('--mode', mode);
  }

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
      extraArgs.push('-c', `${CODEX_SERVICE_TIER_CONFIG_KEY}="${toCodexServiceTier(speed)}"`);
    }
  }

  if (provider.type === 'copilot') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, COPILOT_MODEL_FLAGS)
    ) {
      extraArgs.push('--model', model);
    }
    const effort = getExplicitCopilotReasoningEffort(provider);
    if (effort && !hasCliFlag(baseArgs, COPILOT_REASONING_EFFORT_FLAG)) {
      extraArgs.push(COPILOT_REASONING_EFFORT_FLAG, effort);
    }
  }

  if (provider.type === 'grok-build') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, GROK_BUILD_MODEL_FLAGS)
    ) {
      extraArgs.push('--model', model);
    }
    const effort = getExplicitGrokBuildReasoningEffort(provider);
    if (effort && !hasAnyCliFlag(baseArgs, GROK_BUILD_REASONING_EFFORT_FLAGS)) {
      extraArgs.push('--effort', effort);
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

  if (provider.type === 'cursor' || provider.type === 'devin') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, CURSOR_MODEL_FLAGS)
    ) {
      extraArgs.push('--model', model);
    }
  }

  if (provider.type === 'kimi-code') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, KIMI_CODE_MODEL_FLAGS)
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
 */
export const buildHeteroExecArgs = (
  provider: HeteroSpawnSelectionProvider | undefined | null,
): string[] | undefined => {
  if (!provider) return undefined;
  if (
    provider.type !== 'amp' &&
    provider.type !== 'claude-code' &&
    provider.type !== 'codebuddy' &&
    provider.type !== 'codex' &&
    provider.type !== 'copilot' &&
    provider.type !== 'cursor' &&
    provider.type !== 'droid' &&
    provider.type !== 'devin' &&
    provider.type !== 'grok-build' &&
    provider.type !== 'kimi-code' &&
    provider.type !== 'opencode' &&
    provider.type !== 'pi' &&
    provider.type !== 'qoder' &&
    provider.type !== 'trae'
  ) {
    return provider.args;
  }

  const baseArgs = provider.args ?? [];
  const wrapperArgs = baseArgs.map((arg) => `${HETERO_EXEC_AGENT_ARG_FLAG}=${arg}`);
  const selectorArgs: string[] = [];

  if (provider.type === 'amp') {
    const mode = getExplicitAmpAgentMode(provider);
    if (mode && !hasCliFlag(baseArgs, '--mode')) {
      wrapperArgs.push(
        `${HETERO_EXEC_AGENT_ARG_FLAG}=--mode`,
        `${HETERO_EXEC_AGENT_ARG_FLAG}=${mode}`,
      );
    }
  }

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

  if (provider.type === 'copilot') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, COPILOT_MODEL_FLAGS)
    ) {
      selectorArgs.push('--model', model);
    }
    const effort = getExplicitCopilotReasoningEffort(provider);
    if (effort && !hasCliFlag(baseArgs, COPILOT_REASONING_EFFORT_FLAG)) {
      selectorArgs.push('--effort', effort);
    }
  }

  if (provider.type === 'grok-build') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, GROK_BUILD_MODEL_FLAGS)
    ) {
      wrapperArgs.push(
        `${HETERO_EXEC_AGENT_ARG_FLAG}=--model`,
        `${HETERO_EXEC_AGENT_ARG_FLAG}=${model}`,
      );
    }
    const effort = getExplicitGrokBuildReasoningEffort(provider);
    if (effort && !hasAnyCliFlag(baseArgs, GROK_BUILD_REASONING_EFFORT_FLAGS)) {
      wrapperArgs.push(
        `${HETERO_EXEC_AGENT_ARG_FLAG}=--effort`,
        `${HETERO_EXEC_AGENT_ARG_FLAG}=${effort}`,
      );
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

  if (provider.type === 'cursor' || provider.type === 'devin') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, CURSOR_MODEL_FLAGS)
    ) {
      selectorArgs.push('--model', model);
    }
  }

  if (provider.type === 'kimi-code') {
    const model = provider.model?.trim();
    if (
      model &&
      model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !hasAnyCliFlag(baseArgs, KIMI_CODE_MODEL_FLAGS)
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

  if (provider.type === 'droid' || provider.type === 'trae') {
    const model = provider.model?.trim();
    if (model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION) {
      selectorArgs.push('--model', model);
    }
  }

  const args = [...wrapperArgs, ...selectorArgs];
  return args.length > 0 ? args : undefined;
};
