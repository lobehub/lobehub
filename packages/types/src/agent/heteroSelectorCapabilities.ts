import {
  getAnyCliFlagValue,
  getCliConfigValue,
  getCliFlagValue,
  stripCliConfigKey,
  stripCliFlags,
} from './heteroCliArgs';
import type { LocalHeterogeneousAgentType } from './heterogeneousAgent';

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
const CLAUDE_CODE_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ClaudeCodeReasoningEffort = (typeof CLAUDE_CODE_REASONING_EFFORT_LEVELS)[number];

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

const CODEX_MAX_REASONING_EFFORT_LEVELS = [
  ...CODEX_COMMON_REASONING_EFFORT_LEVELS,
  'max',
] as const satisfies readonly CodexReasoningEffort[];

const CODEX_ULTRA_REASONING_MODELS = ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra'] as const;
const CODEX_MAX_REASONING_MODELS = ['gpt-5.6-luna'] as const;

/**
 * Qoder reasoning-effort levels, mirrored 1:1 with the CLI's
 * `--reasoning-effort <level>` flag.
 */
const QODER_REASONING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type QoderReasoningEffort = (typeof QODER_REASONING_EFFORT_LEVELS)[number];

export const QODER_REASONING_EFFORT_FLAG = '--reasoning-effort';

export type HeterogeneousReasoningEffortLevel =
  ClaudeCodeReasoningEffort | CodexReasoningEffort | QoderReasoningEffort;

export type HeterogeneousReasoningEffort =
  HeterogeneousReasoningEffortLevel | HeterogeneousAgentDefaultSelection;

/**
 * Codex speed modes, mirrored to the CLI config key `service_tier`.
 *
 * `fast` maps to the Fast service tier (request value `priority`): ~1.5x
 * faster inference at a higher credit-consumption rate. Requires ChatGPT
 * sign-in; the Codex CLI silently omits the tier for unsupported models, so
 * passing it is always safe.
 */
export type CodexSpeedMode = 'fast';

export type HeterogeneousSpeedMode = CodexSpeedMode | HeterogeneousAgentDefaultSelection;

export const CODEX_SERVICE_TIER_CONFIG_KEY = 'service_tier';

/**
 * Codex models whose catalog exposes the Fast (`priority`) service tier.
 * Sourced from the model catalog embedded in codex-cli.
 */
const CODEX_FAST_SPEED_MODELS = [
  'gpt-5.6',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
] as const;

/**
 * `service_tier` values the Codex CLI resolves to the Fast tier
 * (`ServiceTier::from_request_value` accepts both spellings).
 */
const CODEX_FAST_SERVICE_TIER_VALUES = ['fast', 'priority'] as const;

export const isClaudeCodeReasoningEffort = (
  value: string | undefined,
): value is ClaudeCodeReasoningEffort =>
  !!value && CLAUDE_CODE_REASONING_EFFORT_LEVELS.includes(value as ClaudeCodeReasoningEffort);

export const isCodexReasoningEffort = (value: string | undefined): value is CodexReasoningEffort =>
  !!value && CODEX_REASONING_EFFORT_LEVELS.includes(value as CodexReasoningEffort);

export const isQoderReasoningEffort = (value: string | undefined): value is QoderReasoningEffort =>
  !!value && QODER_REASONING_EFFORT_LEVELS.includes(value as QoderReasoningEffort);

export const isCodexFastServiceTier = (value: string | undefined): boolean =>
  !!value &&
  CODEX_FAST_SERVICE_TIER_VALUES.includes(value as (typeof CODEX_FAST_SERVICE_TIER_VALUES)[number]);

/**
 * Reasoning-effort levels exposed by a Codex model. Unknown and default model
 * selections use the conservative common set because their actual capability
 * cannot be known until the CLI resolves the model.
 */
export const getCodexReasoningEffortLevels = (model: string): readonly CodexReasoningEffort[] => {
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

/**
 * Whether the Fast speed toggle applies to a selector model value. `default`
 * counts as supported so the CLI remains free to resolve its own model; an
 * unsupported resolved model simply ignores the tier.
 */
export const codexModelSupportsFastSpeed = (model: string): boolean =>
  model === HETEROGENEOUS_AGENT_DEFAULT_SELECTION ||
  CODEX_FAST_SPEED_MODELS.includes(model as (typeof CODEX_FAST_SPEED_MODELS)[number]);

export interface HeteroSelectionSource {
  args?: string[];
  effort?: string | null;
  model?: string | null;
  speed?: string | null;
}

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

  return isCodexFastServiceTier(tier) ? 'fast' : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
};

const resolveQoderReasoningEffort = (
  source: HeteroSelectionSource | null | undefined,
): QoderReasoningEffort | HeterogeneousAgentDefaultSelection => {
  const effort = (
    getCliFlagValue(source?.args, QODER_REASONING_EFFORT_FLAG) ?? source?.effort
  )?.trim();
  return isQoderReasoningEffort(effort) ? effort : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
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
  supported: (model: string) => boolean;
}

export interface HeteroSelectorCapability {
  effort?: HeteroSelectorEffortCapability;
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
  'amp': {},
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
      source: 'static',
    },
    speed: {
      encodings: [{ key: CODEX_SERVICE_TIER_CONFIG_KEY, kind: 'config' }],
      resolve: resolveCodexSpeedMode,
      supported: codexModelSupportsFastSpeed,
    },
  },
  'cursor': {
    model: {
      encodings: [{ flags: ['--model'], kind: 'flag' }],
      resolve: resolvePersistedModel,
      source: 'catalog',
    },
  },
  'kimi-code': {},
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
} satisfies Record<LocalHeterogeneousAgentType, HeteroSelectorCapability>;

export const getHeteroSelectorCapability = (
  type: string | undefined,
): HeteroSelectorCapability | undefined =>
  HETERO_SELECTOR_CAPABILITIES[type as LocalHeterogeneousAgentType];

export const isHeteroSelectorAvailable = (type: string | undefined): boolean =>
  !!getHeteroSelectorCapability(type)?.model;

export interface HeteroSelection {
  effort?: HeterogeneousReasoningEffort;
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

  if ('speed' in selection && capability.speed) {
    args = clearEncodings(args, capability.speed.encodings);
    cleared = true;
  }

  if (cleared) patch.args = args;

  return patch;
};
